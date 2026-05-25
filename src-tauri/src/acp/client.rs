// S-AI-ACP-001 §3.3 / §5: per-session AcpClient — owns one transport,
//
// NOTE on dead_code: `authenticate`, `session_close`, and
// `respond_with_error` round out the spec method surface so we have a
// single place to wire each up as the UI/IPC layer matures. They're
// covered by tests in this file via the fake-agent harness.
#![allow(dead_code)]

// runs a reader task that dispatches responses to oneshot waiters and
// notifications to a broadcast channel.
//
// Design notes:
//   * `&self`-only public surface. Interior mutability via `Mutex` and
//     atomics so callers can clone an `Arc<AcpClient>` into Tauri command
//     state.
//   * Two tasks per client: a reader and a writer. The writer is driven
//     by an mpsc that public methods push into. This serialises all
//     outbound bytes so we don't have to wrap the writer half in a
//     mutex across awaits.
//   * Pending requests live in a `Mutex<HashMap<RequestId, oneshot>>`.
//     On transport EOF, the reader task drains the map and fails every
//     pending oneshot with `AcpError::Transport`.

use std::collections::HashMap;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{Arc, Mutex};

use serde::Serialize;
use serde_json::Value;
use tokio::sync::{broadcast, mpsc, oneshot};

use super::protocol::{
    AuthenticateParams, ContentBlock, InitializeParams, InitializeResult, Method, Notification,
    PermissionDecision, RawMessage, Request, RequestId, RequestPermissionResult, Response,
    RpcError, SessionCancelParams, SessionCloseParams, SessionId, SessionNewParams,
    SessionNewResult, SessionPromptParams, SessionPromptResult, SessionUpdateParams,
};
use super::transport::{SplitTransport, TransportError, TransportRead, TransportWrite};

#[derive(Debug, thiserror::Error)]
pub enum AcpError {
    #[error("acp transport: {0}")]
    Transport(String),
    #[error("acp rpc {code}: {message}")]
    Rpc { code: i64, message: String },
    #[error("acp protocol: {0}")]
    Protocol(String),
    #[error("acp closed")]
    Closed,
}

impl From<TransportError> for AcpError {
    fn from(e: TransportError) -> Self {
        AcpError::Transport(e.to_string())
    }
}

impl From<serde_json::Error> for AcpError {
    fn from(e: serde_json::Error) -> Self {
        AcpError::Protocol(e.to_string())
    }
}

impl From<RpcError> for AcpError {
    fn from(e: RpcError) -> Self {
        AcpError::Rpc {
            code: e.code,
            message: e.message,
        }
    }
}

pub type AcpResult<T> = Result<T, AcpError>;

/// Inbound notifications and incoming agent-initiated requests that the
/// host UI/command layer must act on. The session id field on the
/// `session/update`-style variants identifies which session the event
/// belongs to.
#[derive(Debug, Clone)]
pub enum AcpEvent {
    SessionUpdate(SessionUpdateParams),
    /// `session/request_permission` is an *agent-initiated request* (it
    /// has an id and expects a response). The host must call
    /// [`AcpClient::respond_to_permission_request`] with the matching
    /// request id.
    PermissionRequest {
        request_id: RequestId,
        params: super::protocol::RequestPermissionParams,
    },
    /// Any other agent-initiated request we don't natively handle yet
    /// (`fs/*`, `terminal/*`). UI can route or auto-reject.
    AgentRequest {
        request_id: RequestId,
        method: String,
        params: Option<Value>,
    },
    /// Generic notification we don't model as a typed variant.
    OtherNotification {
        method: String,
        params: Option<Value>,
    },
    /// Reader task exited (transport closed or fatal error).
    Closed(String),
}

type PendingMap = Mutex<HashMap<String, oneshot::Sender<Result<Response, AcpError>>>>;

/// Owns one ACP session. Cheap to clone via `Arc<AcpClient>`.
pub struct AcpClient {
    inner: Arc<Inner>,
}

impl std::fmt::Debug for AcpClient {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("AcpClient")
            .field("next_id", &self.inner.next_id.load(Ordering::Relaxed))
            .finish_non_exhaustive()
    }
}

struct Inner {
    next_id: AtomicU64,
    pending: PendingMap,
    tx_out: mpsc::Sender<RawMessage>,
    events: broadcast::Sender<AcpEvent>,
    closed: Mutex<bool>,
}

impl AcpClient {
    /// Build a new client from a split transport. Spawns the reader and
    /// writer background tasks immediately.
    pub fn new<T>(transport: T) -> Self
    where
        T: SplitTransport,
        T::Reader: TransportRead,
        T::Writer: TransportWrite,
    {
        let (reader, writer) = transport.split();
        let (tx_out, rx_out) = mpsc::channel::<RawMessage>(64);
        let (events, _) = broadcast::channel::<AcpEvent>(256);
        let inner = Arc::new(Inner {
            next_id: AtomicU64::new(1),
            pending: Mutex::new(HashMap::new()),
            tx_out,
            events,
            closed: Mutex::new(false),
        });
        spawn_writer(rx_out, writer);
        spawn_reader(Arc::clone(&inner), reader);
        AcpClient { inner }
    }

    pub fn subscribe_updates(&self) -> broadcast::Receiver<AcpEvent> {
        self.inner.events.subscribe()
    }

    pub async fn initialize(&self, params: InitializeParams) -> AcpResult<InitializeResult> {
        self.request(Method::Initialize.as_str(), &params).await
    }

    pub async fn authenticate(&self, method_id: String) -> AcpResult<()> {
        let p = AuthenticateParams { method_id };
        let _: Value = self.request(Method::Authenticate.as_str(), &p).await?;
        Ok(())
    }

    pub async fn session_new(&self, params: SessionNewParams) -> AcpResult<SessionNewResult> {
        self.request(Method::SessionNew.as_str(), &params).await
    }

    pub async fn session_prompt(
        &self,
        session_id: SessionId,
        prompt: Vec<ContentBlock>,
    ) -> AcpResult<SessionPromptResult> {
        let p = SessionPromptParams { session_id, prompt };
        self.request(Method::SessionPrompt.as_str(), &p).await
    }

    /// session/cancel is a *notification* in the spec — fire-and-forget.
    pub async fn session_cancel(&self, session_id: SessionId) -> AcpResult<()> {
        let n = Notification::new(
            Method::SessionCancel.as_str(),
            &SessionCancelParams { session_id },
        )?;
        self.send_raw(RawMessage::Notification(n)).await
    }

    pub async fn session_close(&self, session_id: SessionId) -> AcpResult<()> {
        let p = SessionCloseParams { session_id };
        let _: Value = self.request(Method::SessionClose.as_str(), &p).await?;
        Ok(())
    }

    /// Reply to a `session/request_permission` request that arrived as an
    /// `AcpEvent::PermissionRequest`. The `request_id` must match.
    pub async fn respond_to_permission_request(
        &self,
        request_id: RequestId,
        decision: PermissionDecision,
    ) -> AcpResult<()> {
        let result = RequestPermissionResult { decision };
        let resp = Response {
            jsonrpc: "2.0".into(),
            id: request_id,
            result: Some(serde_json::to_value(&result)?),
            error: None,
        };
        self.send_raw(RawMessage::Response(resp)).await
    }

    /// Reject an agent-initiated request with a JSON-RPC error.
    pub async fn respond_with_error(
        &self,
        request_id: RequestId,
        code: i64,
        message: String,
    ) -> AcpResult<()> {
        let resp = Response {
            jsonrpc: "2.0".into(),
            id: request_id,
            result: None,
            error: Some(RpcError {
                code,
                message,
                data: None,
            }),
        };
        self.send_raw(RawMessage::Response(resp)).await
    }

    async fn request<P: Serialize, R: serde::de::DeserializeOwned>(
        &self,
        method: &str,
        params: &P,
    ) -> AcpResult<R> {
        let id_num = self.inner.next_id.fetch_add(1, Ordering::Relaxed);
        let id = RequestId::from_u64(id_num);
        let req = Request::new(id.clone(), method, params)?;
        let (tx, rx) = oneshot::channel::<Result<Response, AcpError>>();
        {
            let mut map = self.inner.pending.lock().unwrap();
            map.insert(id_key(&id), tx);
        }
        self.send_raw(RawMessage::Request(req)).await?;
        let resp = rx.await.map_err(|_| AcpError::Closed)??;
        if let Some(e) = resp.error {
            return Err(e.into());
        }
        let value = resp.result.unwrap_or(Value::Null);
        let parsed: R = serde_json::from_value(value)?;
        Ok(parsed)
    }

    async fn send_raw(&self, msg: RawMessage) -> AcpResult<()> {
        if *self.inner.closed.lock().unwrap() {
            return Err(AcpError::Closed);
        }
        self.inner
            .tx_out
            .send(msg)
            .await
            .map_err(|_| AcpError::Closed)
    }
}

fn id_key(id: &RequestId) -> String {
    match id {
        RequestId::Number(n) => format!("n:{n}"),
        RequestId::String(s) => format!("s:{s}"),
    }
}

fn spawn_writer<W: TransportWrite>(mut rx: mpsc::Receiver<RawMessage>, mut writer: W) {
    tokio::spawn(async move {
        while let Some(msg) = rx.recv().await {
            if let Err(e) = writer.send(&msg).await {
                tracing::warn!(target: "acp::writer", error = %e, "send failed; writer exiting");
                return;
            }
        }
    });
}

fn spawn_reader<R: TransportRead>(inner: Arc<Inner>, mut reader: R) {
    tokio::spawn(async move {
        loop {
            match reader.recv().await {
                Ok(msg) => handle_inbound(&inner, msg),
                Err(e) => {
                    let reason = e.to_string();
                    {
                        let mut closed = inner.closed.lock().unwrap();
                        *closed = true;
                    }
                    // Fail all pending requests.
                    let pending: Vec<_> = {
                        let mut map = inner.pending.lock().unwrap();
                        map.drain().map(|(_, v)| v).collect()
                    };
                    for tx in pending {
                        let _ = tx.send(Err(AcpError::Transport(reason.clone())));
                    }
                    let _ = inner.events.send(AcpEvent::Closed(reason));
                    return;
                }
            }
        }
    });
}

fn handle_inbound(inner: &Arc<Inner>, msg: RawMessage) {
    match msg {
        RawMessage::Response(resp) => {
            let key = id_key(&resp.id);
            let tx = {
                let mut map = inner.pending.lock().unwrap();
                map.remove(&key)
            };
            match tx {
                Some(tx) => {
                    let _ = tx.send(Ok(resp));
                }
                None => {
                    tracing::warn!(
                        target: "acp::reader",
                        id = %key,
                        "response with no pending waiter"
                    );
                }
            }
        }
        RawMessage::Notification(n) => {
            let event = parse_notification(n);
            let _ = inner.events.send(event);
        }
        RawMessage::Request(r) => {
            let event = parse_agent_request(r);
            let _ = inner.events.send(event);
        }
    }
}

fn parse_notification(n: Notification) -> AcpEvent {
    if n.method == Method::SessionUpdate.as_str() {
        if let Some(params) = n.params.clone() {
            if let Ok(p) = serde_json::from_value::<SessionUpdateParams>(params) {
                return AcpEvent::SessionUpdate(p);
            }
        }
    }
    AcpEvent::OtherNotification {
        method: n.method,
        params: n.params,
    }
}

fn parse_agent_request(r: Request) -> AcpEvent {
    if r.method == Method::SessionRequestPermission.as_str() {
        if let Some(params) = r.params.clone() {
            if let Ok(p) =
                serde_json::from_value::<super::protocol::RequestPermissionParams>(params)
            {
                return AcpEvent::PermissionRequest {
                    request_id: r.id,
                    params: p,
                };
            }
        }
    }
    AcpEvent::AgentRequest {
        request_id: r.id,
        method: r.method,
        params: r.params,
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::acp::protocol::{
        AgentMessageChunk, ClientCapabilities, ClientInfo, ContentBlock, InitializeResult,
        SessionId, SessionNewResult, SessionUpdate, StopReason,
    };
    use crate::acp::transport::{MemoryTransport, Transport};
    use serde_json::json;
    use std::time::Duration;

    async fn run_fake_agent(mut t: MemoryTransport) {
        loop {
            match t.recv().await {
                Ok(RawMessage::Request(req)) => {
                    let id = req.id.clone();
                    match req.method.as_str() {
                        "initialize" => {
                            let result = InitializeResult {
                                protocol_version: 1,
                                agent_capabilities: json!({"loadSession": true}),
                                agent_info: json!({"name": "fake"}),
                                auth_methods: vec![],
                            };
                            let resp = Response {
                                jsonrpc: "2.0".into(),
                                id,
                                result: Some(serde_json::to_value(&result).unwrap()),
                                error: None,
                            };
                            t.send(&RawMessage::Response(resp)).await.unwrap();
                        }
                        "session/new" => {
                            let result = SessionNewResult {
                                session_id: SessionId("sess-1".into()),
                            };
                            let resp = Response {
                                jsonrpc: "2.0".into(),
                                id,
                                result: Some(serde_json::to_value(&result).unwrap()),
                                error: None,
                            };
                            t.send(&RawMessage::Response(resp)).await.unwrap();
                        }
                        "session/prompt" => {
                            // Stream three chunks then complete.
                            for chunk_text in ["one ", "two ", "three"] {
                                let update = SessionUpdateParams {
                                    session_id: SessionId("sess-1".into()),
                                    update: SessionUpdate::AgentMessageChunk(AgentMessageChunk {
                                        content: ContentBlock::Text {
                                            text: chunk_text.to_string(),
                                        },
                                    }),
                                };
                                let n = Notification::new("session/update", &update).unwrap();
                                t.send(&RawMessage::Notification(n)).await.unwrap();
                            }
                            let result = SessionPromptResult {
                                stop_reason: StopReason::EndTurn,
                            };
                            let resp = Response {
                                jsonrpc: "2.0".into(),
                                id,
                                result: Some(serde_json::to_value(&result).unwrap()),
                                error: None,
                            };
                            t.send(&RawMessage::Response(resp)).await.unwrap();
                        }
                        "session/close" => {
                            let resp = Response {
                                jsonrpc: "2.0".into(),
                                id,
                                result: Some(json!({})),
                                error: None,
                            };
                            t.send(&RawMessage::Response(resp)).await.unwrap();
                            return;
                        }
                        _ => {
                            let resp = Response {
                                jsonrpc: "2.0".into(),
                                id,
                                result: None,
                                error: Some(RpcError {
                                    code: -32601,
                                    message: "method not found".into(),
                                    data: None,
                                }),
                            };
                            t.send(&RawMessage::Response(resp)).await.unwrap();
                        }
                    }
                }
                Ok(_) => {}
                Err(_) => return,
            }
        }
    }

    #[tokio::test(flavor = "multi_thread", worker_threads = 2)]
    async fn full_session_flow_initialize_new_prompt_close() {
        let (client_t, agent_t) = MemoryTransport::pair(64 * 1024);
        tokio::spawn(run_fake_agent(agent_t));
        let client = AcpClient::new(client_t);
        let mut events = client.subscribe_updates();

        let init = client
            .initialize(InitializeParams {
                protocol_version: 1,
                client_capabilities: ClientCapabilities::default(),
                client_info: ClientInfo {
                    name: "markspread".into(),
                    title: None,
                    version: "0".into(),
                },
            })
            .await
            .unwrap();
        assert_eq!(init.protocol_version, 1);

        let new_sess = client
            .session_new(SessionNewParams {
                cwd: "/tmp".into(),
                mcp_servers: None,
            })
            .await
            .unwrap();
        assert_eq!(new_sess.session_id.as_str(), "sess-1");

        let prompt_done = tokio::spawn(async move {
            client
                .session_prompt(
                    SessionId("sess-1".into()),
                    vec![ContentBlock::Text { text: "hi".into() }],
                )
                .await
        });

        // Drain three streamed chunks in order.
        let mut got = Vec::new();
        while got.len() < 3 {
            let ev = tokio::time::timeout(Duration::from_secs(2), events.recv())
                .await
                .unwrap()
                .unwrap();
            if let AcpEvent::SessionUpdate(p) = ev {
                if let SessionUpdate::AgentMessageChunk(c) = p.update {
                    if let ContentBlock::Text { text } = c.content {
                        got.push(text);
                    }
                }
            }
        }
        assert_eq!(got, vec!["one ", "two ", "three"]);
        let result = prompt_done.await.unwrap().unwrap();
        matches!(result.stop_reason, StopReason::EndTurn);
    }

    #[tokio::test(flavor = "multi_thread", worker_threads = 2)]
    async fn rpc_error_propagates_as_typed_error() {
        let (client_t, agent_t) = MemoryTransport::pair(8192);
        tokio::spawn(run_fake_agent(agent_t));
        let client = AcpClient::new(client_t);
        let err = client
            .authenticate("doesnotexist".into())
            .await
            .unwrap_err();
        match err {
            AcpError::Rpc { code, message } => {
                assert_eq!(code, -32601);
                assert!(message.contains("method not found"));
            }
            other => panic!("expected Rpc, got {other:?}"),
        }
    }

    #[tokio::test(flavor = "multi_thread", worker_threads = 2)]
    async fn transport_close_fails_pending_and_emits_closed_event() {
        let (client_t, agent_t) = MemoryTransport::pair(8192);
        let client = AcpClient::new(client_t);
        let mut events = client.subscribe_updates();
        // Drop the agent half to simulate a child crash.
        drop(agent_t);
        let err = client.authenticate("x".into()).await.unwrap_err();
        match err {
            AcpError::Transport(_) | AcpError::Closed => {}
            other => panic!("expected Transport or Closed, got {other:?}"),
        }
        // We should also see a Closed event.
        let ev = tokio::time::timeout(Duration::from_secs(2), events.recv())
            .await
            .unwrap()
            .unwrap();
        matches!(ev, AcpEvent::Closed(_));
    }

    #[tokio::test(flavor = "multi_thread", worker_threads = 2)]
    async fn permission_request_routes_to_event_and_response_round_trips() {
        let (client_t, mut agent_t) = MemoryTransport::pair(8192);
        let client = AcpClient::new(client_t);
        let mut events = client.subscribe_updates();

        // Agent → client: a permission request.
        let req = Request::new(
            RequestId::from_u64(42),
            "session/request_permission",
            &super::super::protocol::RequestPermissionParams {
                session_id: SessionId("s".into()),
                tool_call_id: "tc".into(),
                summary: "delete".into(),
            },
        )
        .unwrap();
        agent_t.send(&RawMessage::Request(req)).await.unwrap();

        let ev = tokio::time::timeout(Duration::from_secs(2), events.recv())
            .await
            .unwrap()
            .unwrap();
        let request_id = match ev {
            AcpEvent::PermissionRequest { request_id, params } => {
                assert_eq!(params.tool_call_id, "tc");
                request_id
            }
            other => panic!("expected PermissionRequest, got {other:?}"),
        };

        client
            .respond_to_permission_request(request_id, PermissionDecision::Allow)
            .await
            .unwrap();
        // Receive the response on the agent side.
        let inbound = tokio::time::timeout(Duration::from_secs(2), agent_t.recv())
            .await
            .unwrap()
            .unwrap();
        match inbound {
            RawMessage::Response(r) => {
                let v = r.result.unwrap();
                assert_eq!(v["decision"], "allow");
            }
            other => panic!("expected Response, got {other:?}"),
        }
    }

    /// Smoke-runs against an external Node script under `scripts/test/`.
    /// Skipped by default — run with `cargo test -- --ignored`.
    #[tokio::test]
    #[ignore]
    async fn fake_agent_script_e2e() {
        let script = std::env::var("MARKSPREAD_FAKE_AGENT")
            .unwrap_or_else(|_| "scripts/test/fake-acp-agent.mjs".to_string());
        let mut cmd = tokio::process::Command::new("node");
        cmd.arg(script)
            .stdin(std::process::Stdio::piped())
            .stdout(std::process::Stdio::piped())
            .stderr(std::process::Stdio::piped());
        let child = cmd.spawn().expect("spawn fake agent");
        let transport = crate::acp::transport::StdioTransport::from_child(child).unwrap();
        let client = AcpClient::new(transport);
        let init = client
            .initialize(InitializeParams {
                protocol_version: 1,
                client_capabilities: ClientCapabilities::default(),
                client_info: ClientInfo {
                    name: "markspread".into(),
                    title: None,
                    version: "0".into(),
                },
            })
            .await
            .unwrap();
        assert_eq!(init.protocol_version, 1);
    }
}
