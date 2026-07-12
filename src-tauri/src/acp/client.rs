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
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{Arc, Mutex};
use std::time::Duration;

use serde::Serialize;
use serde_json::Value;
use tokio::sync::{broadcast, mpsc, oneshot};

use super::protocol::{
    AuthenticateParams, ContentBlock, FsReadTextFileParams, FsReadTextFileResult,
    FsWriteTextFileParams, InitializeParams, InitializeResult, Method, Notification,
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

/// Upper bound on how long `session/close` waits for the agent's ack.
/// A dead/hung transport previously blocked `acp_close_session` forever;
/// the manager entry is force-removed by the caller regardless of the RPC
/// outcome, so a graceful ack is worth at most this much waiting.
pub const SESSION_CLOSE_TIMEOUT: Duration = Duration::from_secs(2);

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
    /// Workspace root that bounds client-side `fs/*` operations. When set,
    /// `fs/read_text_file` and `fs/write_text_file` agent requests are
    /// serviced *by us* (real disk IO) and answered on the wire — this is
    /// the leg that turns an `allow` decision into an actual file change.
    /// When `None` (e.g. unit tests that don't exercise fs), those requests
    /// are only surfaced as events for the UI to handle.
    fs_root: Mutex<Option<PathBuf>>,
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
            fs_root: Mutex::new(None),
        });
        spawn_writer(rx_out, writer);
        spawn_reader(Arc::clone(&inner), reader);
        AcpClient { inner }
    }

    /// Bound client-side `fs/*` requests to `root`. Must be called before
    /// the agent starts issuing tool calls (i.e. right after `session/new`).
    /// Paths outside `root` are rejected so a misbehaving agent can't write
    /// arbitrary files on the host.
    pub fn set_fs_root(&self, root: PathBuf) {
        *self.inner.fs_root.lock().unwrap() = Some(root);
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

    /// `session/close` is bounded by [`SESSION_CLOSE_TIMEOUT`]: a dead or
    /// unresponsive transport must never hang the caller — the host is about
    /// to force-drop the session either way, so we only wait briefly for a
    /// graceful ack.
    pub async fn session_close(&self, session_id: SessionId) -> AcpResult<()> {
        self.session_close_with_timeout(session_id, SESSION_CLOSE_TIMEOUT)
            .await
    }

    /// Timeout-parameterised variant of [`Self::session_close`] so tests can
    /// exercise the deadline without waiting the production duration.
    pub async fn session_close_with_timeout(
        &self,
        session_id: SessionId,
        deadline: Duration,
    ) -> AcpResult<()> {
        let p = SessionCloseParams { session_id };
        let _: Value = self
            .request_with_deadline(Method::SessionClose.as_str(), &p, Some(deadline))
            .await?;
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
        self.request_with_deadline(method, params, None).await
    }

    /// Core request path. `deadline: Some(d)` bounds the wait for the
    /// response; on expiry the pending waiter is removed (so a late
    /// response doesn't warn-spam the reader) and `AcpError::Transport`
    /// is returned.
    async fn request_with_deadline<P: Serialize, R: serde::de::DeserializeOwned>(
        &self,
        method: &str,
        params: &P,
        deadline: Option<Duration>,
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
        let resp = match deadline {
            None => rx.await.map_err(|_| AcpError::Closed)??,
            Some(d) => match tokio::time::timeout(d, rx).await {
                Ok(inner) => inner.map_err(|_| AcpError::Closed)??,
                Err(_elapsed) => {
                    let mut map = self.inner.pending.lock().unwrap();
                    map.remove(&id_key(&id));
                    return Err(AcpError::Transport(format!(
                        "{method} timed out after {}ms",
                        d.as_millis()
                    )));
                }
            },
        };
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
            // Client-side filesystem tool calls (`fs/read_text_file`,
            // `fs/write_text_file`) are *our* responsibility per the ACP
            // spec: we advertised the capability, so we perform the IO and
            // answer on the wire. This is the leg that makes an `allow`
            // decision produce a real disk change. We still emit an event so
            // the UI can reflect it (editor/preview refresh).
            if r.method == Method::FsWriteTextFile.as_str()
                || r.method == Method::FsReadTextFile.as_str()
            {
                handle_fs_request(inner, r);
            } else {
                let event = parse_agent_request(r);
                let _ = inner.events.send(event);
            }
        }
    }
}

/// Resolve `requested` against `root`, rejecting any path that escapes the
/// workspace root (absolute paths outside root, or `..` traversal). Returns
/// the canonical-ish absolute path to operate on.
fn confine_to_root(root: &Path, requested: &str) -> Result<PathBuf, String> {
    let req = Path::new(requested);
    let joined = if req.is_absolute() {
        req.to_path_buf()
    } else {
        root.join(req)
    };
    // Reject `..` traversal lexically (we can't canonicalize a not-yet-created
    // write target, so do it by component analysis).
    let mut normalized = PathBuf::new();
    for comp in joined.components() {
        use std::path::Component;
        match comp {
            Component::ParentDir => {
                if !normalized.pop() {
                    return Err("path escapes workspace root".into());
                }
            }
            Component::CurDir => {}
            other => normalized.push(other.as_os_str()),
        }
    }
    if !normalized.starts_with(root) {
        return Err("path escapes workspace root".into());
    }
    Ok(normalized)
}

/// Service an `fs/*` agent request: perform real disk IO bounded by the
/// session's workspace root, then answer the agent with a JSON-RPC response.
/// Also emits an `AgentRequest` event so the UI can refresh editor/preview.
fn handle_fs_request(inner: &Arc<Inner>, r: Request) {
    let root = inner.fs_root.lock().unwrap().clone();
    let inner = Arc::clone(inner);
    tokio::spawn(async move {
        // Surface the request to the UI regardless of how we service it.
        let _ = inner.events.send(AcpEvent::AgentRequest {
            request_id: r.id.clone(),
            method: r.method.clone(),
            params: r.params.clone(),
        });

        let Some(root) = root else {
            // No workspace bound — refuse rather than touch arbitrary disk.
            let _ = send_response(
                &inner,
                Response {
                    jsonrpc: "2.0".into(),
                    id: r.id,
                    result: None,
                    error: Some(RpcError {
                        code: -32603,
                        message: "fs root not configured".into(),
                        data: None,
                    }),
                },
            )
            .await;
            return;
        };

        let resp = if r.method == Method::FsWriteTextFile.as_str() {
            service_write(&root, &r)
        } else {
            service_read(&root, &r)
        };
        let _ = send_response(&inner, resp).await;
    });
}

fn service_write(root: &Path, r: &Request) -> Response {
    let parsed: Result<FsWriteTextFileParams, _> = r
        .params
        .clone()
        .ok_or_else(|| "missing params".to_string())
        .and_then(|v| serde_json::from_value(v).map_err(|e| e.to_string()));
    match parsed {
        Ok(p) => match confine_to_root(root, &p.path) {
            Ok(abs) => {
                let io = (|| {
                    if let Some(parent) = abs.parent() {
                        std::fs::create_dir_all(parent)?;
                    }
                    std::fs::write(&abs, p.content.as_bytes())
                })();
                match io {
                    Ok(()) => ok_response(r.id.clone(), Value::Null),
                    Err(e) => err_response(r.id.clone(), -32603, format!("fs write: {e}")),
                }
            }
            Err(e) => err_response(r.id.clone(), -32602, e),
        },
        Err(e) => err_response(r.id.clone(), -32602, format!("invalid params: {e}")),
    }
}

fn service_read(root: &Path, r: &Request) -> Response {
    let parsed: Result<FsReadTextFileParams, _> = r
        .params
        .clone()
        .ok_or_else(|| "missing params".to_string())
        .and_then(|v| serde_json::from_value(v).map_err(|e| e.to_string()));
    match parsed {
        Ok(p) => match confine_to_root(root, &p.path) {
            Ok(abs) => match std::fs::read_to_string(&abs) {
                Ok(content) => {
                    let result = FsReadTextFileResult { content };
                    match serde_json::to_value(&result) {
                        Ok(v) => ok_response(r.id.clone(), v),
                        Err(e) => err_response(r.id.clone(), -32603, e.to_string()),
                    }
                }
                Err(e) => err_response(r.id.clone(), -32603, format!("fs read: {e}")),
            },
            Err(e) => err_response(r.id.clone(), -32602, e),
        },
        Err(e) => err_response(r.id.clone(), -32602, format!("invalid params: {e}")),
    }
}

fn ok_response(id: RequestId, result: Value) -> Response {
    Response {
        jsonrpc: "2.0".into(),
        id,
        result: Some(result),
        error: None,
    }
}

fn err_response(id: RequestId, code: i64, message: String) -> Response {
    Response {
        jsonrpc: "2.0".into(),
        id,
        result: None,
        error: Some(RpcError {
            code,
            message,
            data: None,
        }),
    }
}

async fn send_response(inner: &Arc<Inner>, resp: Response) -> Result<(), AcpError> {
    if *inner.closed.lock().unwrap() {
        return Err(AcpError::Closed);
    }
    inner
        .tx_out
        .send(RawMessage::Response(resp))
        .await
        .map_err(|_| AcpError::Closed)
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

    // F15 regression: an agent that stays *alive but silent* (transport
    // open, no response) must not hang `session/close` forever. Before the
    // deadline landed, `rx.await` blocked indefinitely and
    // `acp::tests::close_session_removes_entry_from_manager` deadlocked the
    // whole #[serial] suite.
    #[tokio::test(flavor = "multi_thread", worker_threads = 2)]
    async fn session_close_times_out_on_unresponsive_agent() {
        let (client_t, _agent_t) = MemoryTransport::pair(8192);
        // NB: `_agent_t` is intentionally kept alive — the transport stays
        // open so the request is neither answered nor failed by EOF.
        let client = AcpClient::new(client_t);
        let started = std::time::Instant::now();
        let err = client
            .session_close_with_timeout(SessionId("silent".into()), Duration::from_millis(100))
            .await
            .unwrap_err();
        match err {
            AcpError::Transport(msg) => assert!(msg.contains("timed out"), "got: {msg}"),
            other => panic!("expected Transport timeout, got {other:?}"),
        }
        assert!(
            started.elapsed() < Duration::from_secs(2),
            "close must return promptly after the deadline"
        );
        // The pending waiter was removed on expiry — no leak.
        assert!(client.inner.pending.lock().unwrap().is_empty());
    }

    #[tokio::test(flavor = "multi_thread", worker_threads = 2)]
    async fn session_close_succeeds_within_deadline_on_responsive_agent() {
        let (client_t, agent_t) = MemoryTransport::pair(8192);
        tokio::spawn(run_fake_agent(agent_t));
        let client = AcpClient::new(client_t);
        client
            .session_close(SessionId("sess-1".into()))
            .await
            .expect("responsive agent must ack close inside the deadline");
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

    // ─── allow → real disk write end-to-end (N2/N11) ────────────────────
    //
    // These tests drive the *full* approval-to-disk path with no mocked
    // responses: a fake agent asks for permission, the host answers
    // (allow/deny), and on allow the agent re-invokes `fs/write_text_file`,
    // which our `handle_fs_request` services against a real temp dir. The
    // assertion is externally observable — we read the file off disk and
    // compare content + mtime, exactly the contract the task demands.

    /// Fake agent for the fs flow. On `session/prompt`:
    ///   1. sends `session/request_permission` to the host and waits,
    ///   2. if the host's decision is `allow`/`allow_once`, sends
    ///      `fs/write_text_file` with `target_path`/`target_content`,
    ///   3. completes the prompt with `end_turn`.
    ///
    /// Returns nothing; runs until the transport closes.
    async fn run_fs_fake_agent(
        mut t: MemoryTransport,
        target_path: String,
        target_content: String,
    ) {
        // pending host responses keyed by our outbound request id.
        let mut next_id: u64 = 1000;
        loop {
            match t.recv().await {
                Ok(RawMessage::Request(req)) => {
                    let id = req.id.clone();
                    match req.method.as_str() {
                        "initialize" => {
                            let result = InitializeResult {
                                protocol_version: 1,
                                agent_capabilities: json!({}),
                                agent_info: json!({"name": "fs-fake"}),
                                auth_methods: vec![],
                            };
                            send_ok(&mut t, id, serde_json::to_value(&result).unwrap()).await;
                        }
                        "session/new" => {
                            let result = SessionNewResult {
                                session_id: SessionId("sess-fs".into()),
                            };
                            send_ok(&mut t, id, serde_json::to_value(&result).unwrap()).await;
                        }
                        "session/prompt" => {
                            // 1. ask permission.
                            let perm_id = next_id;
                            next_id += 1;
                            let perm = Request::new(
                                RequestId::from_u64(perm_id),
                                "session/request_permission",
                                &super::super::protocol::RequestPermissionParams {
                                    session_id: SessionId("sess-fs".into()),
                                    tool_call_id: "tc-write".into(),
                                    summary: "write file".into(),
                                },
                            )
                            .unwrap();
                            t.send(&RawMessage::Request(perm)).await.unwrap();

                            // 2. wait for the host's decision response.
                            let decision = loop {
                                match t.recv().await {
                                    Ok(RawMessage::Response(r)) if matches!(&r.id, RequestId::Number(n) if *n == perm_id) =>
                                    {
                                        break r
                                            .result
                                            .and_then(|v| {
                                                v.get("decision")
                                                    .and_then(|d| d.as_str())
                                                    .map(|s| s.to_string())
                                            })
                                            .unwrap_or_default();
                                    }
                                    Ok(_) => continue,
                                    Err(_) => return,
                                }
                            };

                            // 3. on allow, re-invoke the write tool. The host's
                            //    fs handler performs the real disk write and
                            //    answers us.
                            if decision == "allow" || decision == "allow_once" {
                                let w_id = next_id;
                                next_id += 1;
                                let w = Request::new(
                                    RequestId::from_u64(w_id),
                                    "fs/write_text_file",
                                    &FsWriteTextFileParams {
                                        path: target_path.clone(),
                                        content: target_content.clone(),
                                    },
                                )
                                .unwrap();
                                t.send(&RawMessage::Request(w)).await.unwrap();
                                // Drain the host's fs response before completing.
                                loop {
                                    match t.recv().await {
                                        Ok(RawMessage::Response(r)) if matches!(&r.id, RequestId::Number(n) if *n == w_id) =>
                                        {
                                            break;
                                        }
                                        Ok(_) => continue,
                                        Err(_) => return,
                                    }
                                }
                            }

                            // 4. complete the prompt.
                            let result = SessionPromptResult {
                                stop_reason: StopReason::EndTurn,
                            };
                            send_ok(&mut t, id, serde_json::to_value(&result).unwrap()).await;
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

    async fn send_ok(t: &mut MemoryTransport, id: RequestId, result: Value) {
        let resp = Response {
            jsonrpc: "2.0".into(),
            id,
            result: Some(result),
            error: None,
        };
        t.send(&RawMessage::Response(resp)).await.unwrap();
    }

    /// Drive a prompt against the fs fake agent, answering the permission
    /// request with `decision`. Returns once the prompt completes.
    async fn drive_fs_flow(client: &AcpClient, decision: PermissionDecision) {
        let mut events = client.subscribe_updates();
        // Spawn the prompt; it completes only after the whole tool dance.
        let prompt = {
            // SAFETY: client outlives the spawned future via the await below.
            let fut = client.session_prompt(
                SessionId("sess-fs".into()),
                vec![ContentBlock::Text {
                    text: "write the file".into(),
                }],
            );
            fut
        };
        // Run the prompt and the permission-answer concurrently.
        let answer = async {
            loop {
                let ev = tokio::time::timeout(Duration::from_secs(5), events.recv())
                    .await
                    .expect("event timeout")
                    .expect("event recv");
                if let AcpEvent::PermissionRequest { request_id, .. } = ev {
                    client
                        .respond_to_permission_request(request_id, decision)
                        .await
                        .unwrap();
                    return;
                }
            }
        };
        let joined = async {
            let (_answered, prompt_res) = tokio::join!(answer, prompt);
            prompt_res
        };
        let prompt_res = tokio::time::timeout(Duration::from_secs(10), joined)
            .await
            .expect("fs flow timed out — a leg of the allow→write→complete path hung");
        prompt_res.expect("prompt result");
    }

    #[tokio::test(flavor = "multi_thread", worker_threads = 2)]
    async fn allow_decision_writes_real_file_to_disk() {
        let dir = tempfile::tempdir().unwrap();
        let root = dir.path().to_path_buf();
        let target = root.join("notes.md");
        // Pre-seed an existing file so we can observe a content + mtime change.
        std::fs::write(&target, "OLD CONTENT\n").unwrap();
        let before_meta = std::fs::metadata(&target).unwrap();
        let before_mtime = before_meta.modified().unwrap();
        // Ensure a measurable mtime delta on coarse-grained filesystems.
        std::thread::sleep(Duration::from_millis(20));

        let (client_t, agent_t) = MemoryTransport::pair(64 * 1024);
        tokio::spawn(run_fs_fake_agent(
            agent_t,
            target.to_string_lossy().into_owned(),
            "NEW CONTENT FROM AGENT\n".into(),
        ));
        let client = AcpClient::new(client_t);
        client.set_fs_root(root.clone());
        client
            .initialize(InitializeParams {
                protocol_version: 1,
                client_capabilities: ClientCapabilities::default(),
                client_info: ClientInfo {
                    name: "m".into(),
                    title: None,
                    version: "0".into(),
                },
            })
            .await
            .unwrap();
        client
            .session_new(SessionNewParams {
                cwd: root.to_string_lossy().into_owned(),
                mcp_servers: None,
            })
            .await
            .unwrap();

        drive_fs_flow(&client, PermissionDecision::Allow).await;

        // Externally observable: the file on disk actually changed.
        let after = std::fs::read_to_string(&target).unwrap();
        assert_eq!(
            after, "NEW CONTENT FROM AGENT\n",
            "allow must produce the agent's new content on disk"
        );
        let after_mtime = std::fs::metadata(&target).unwrap().modified().unwrap();
        assert!(
            after_mtime > before_mtime,
            "mtime must advance after a real write (before={before_mtime:?} after={after_mtime:?})"
        );
    }

    #[tokio::test(flavor = "multi_thread", worker_threads = 2)]
    async fn deny_decision_leaves_file_unchanged() {
        let dir = tempfile::tempdir().unwrap();
        let root = dir.path().to_path_buf();
        let target = root.join("notes.md");
        std::fs::write(&target, "ORIGINAL\n").unwrap();
        let before_mtime = std::fs::metadata(&target).unwrap().modified().unwrap();
        std::thread::sleep(Duration::from_millis(20));

        let (client_t, agent_t) = MemoryTransport::pair(64 * 1024);
        tokio::spawn(run_fs_fake_agent(
            agent_t,
            target.to_string_lossy().into_owned(),
            "SHOULD NOT BE WRITTEN\n".into(),
        ));
        let client = AcpClient::new(client_t);
        client.set_fs_root(root.clone());
        client
            .initialize(InitializeParams {
                protocol_version: 1,
                client_capabilities: ClientCapabilities::default(),
                client_info: ClientInfo {
                    name: "m".into(),
                    title: None,
                    version: "0".into(),
                },
            })
            .await
            .unwrap();
        client
            .session_new(SessionNewParams {
                cwd: root.to_string_lossy().into_owned(),
                mcp_servers: None,
            })
            .await
            .unwrap();

        drive_fs_flow(&client, PermissionDecision::Deny).await;

        // Externally observable: deny means no write — content + mtime intact.
        let after = std::fs::read_to_string(&target).unwrap();
        assert_eq!(after, "ORIGINAL\n", "deny must leave the file untouched");
        let after_mtime = std::fs::metadata(&target).unwrap().modified().unwrap();
        assert_eq!(
            after_mtime, before_mtime,
            "deny must not advance mtime — no disk write should occur"
        );
    }

    #[tokio::test(flavor = "multi_thread", worker_threads = 2)]
    async fn fs_write_outside_root_is_rejected_and_not_written() {
        // Path traversal must not let an agent write outside the workspace.
        let dir = tempfile::tempdir().unwrap();
        let root = dir.path().join("workspace");
        std::fs::create_dir_all(&root).unwrap();
        let outside = dir.path().join("escaped.md");
        assert!(!outside.exists());

        let (client_t, agent_t) = MemoryTransport::pair(64 * 1024);
        // Agent targets `../escaped.md` relative to root.
        tokio::spawn(run_fs_fake_agent(
            agent_t,
            "../escaped.md".into(),
            "ESCAPED\n".into(),
        ));
        let client = AcpClient::new(client_t);
        client.set_fs_root(root.clone());
        client
            .initialize(InitializeParams {
                protocol_version: 1,
                client_capabilities: ClientCapabilities::default(),
                client_info: ClientInfo {
                    name: "m".into(),
                    title: None,
                    version: "0".into(),
                },
            })
            .await
            .unwrap();
        client
            .session_new(SessionNewParams {
                cwd: root.to_string_lossy().into_owned(),
                mcp_servers: None,
            })
            .await
            .unwrap();

        drive_fs_flow(&client, PermissionDecision::Allow).await;

        assert!(
            !outside.exists(),
            "path traversal must be rejected — no file written outside root"
        );
    }
}
