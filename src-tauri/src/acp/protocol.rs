// S-AI-ACP-001 §2.1-2.3: JSON-RPC 2.0 wire types for ACP v1.
//
// NOTE on dead_code: this module ships the full spec wire surface so the
// transport/client layers can route messages typed correctly from day one.
// Several `params`/`result` types (fs/*, terminal/*, session/load+resume,
// authenticate) are produced/consumed only by tests in this commit — the
// UI/IPC wiring lands in subsequent commits per the spec's staged plan.
// Allowing dead_code here keeps clippy clean without per-item allows that
// would have to be removed later.
#![allow(dead_code)]

//
// Framing is NDJSON (one JSON value per line). Keys are camelCase, paths
// absolute, line numbers 1-based. See `transport.rs` for the byte layer
// and `client.rs` for the request/response correlator.
//
// We model JSON-RPC at two levels:
//   * `RawMessage` is the untagged top-level frame the transport reads —
//     either request, response, or notification.
//   * `Request`/`Response`/`Notification` carry the typed `Params` enum
//     dispatched by the `method` field.
//
// We do NOT enumerate every leaf field of every params type (e.g. the
// full `AgentCapabilities` schema). Instead we use `serde_json::Value`
// for the deep nested objects so the client survives spec extensions —
// the registry / UI layers can pick apart what they need.

use serde::{Deserialize, Serialize};
use serde_json::Value;

/// Opaque identifier handed out by an ACP agent in response to `session/new`.
/// Treated as a string by us; agents are free to choose any encoding.
#[derive(Debug, Clone, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(transparent)]
pub struct SessionId(pub String);

impl SessionId {
    pub fn as_str(&self) -> &str {
        &self.0
    }
}

impl From<String> for SessionId {
    fn from(s: String) -> Self {
        Self(s)
    }
}

/// Markspread-side identifier for a configured agent (e.g. "claude", "codex").
/// Not the same as the agent's own `agentInfo.name`.
#[derive(Debug, Clone, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(transparent)]
pub struct AgentId(pub String);

impl AgentId {
    pub fn as_str(&self) -> &str {
        &self.0
    }
}

impl From<&str> for AgentId {
    fn from(s: &str) -> Self {
        Self(s.to_string())
    }
}

/// JSON-RPC numeric request id. Spec allows strings too; we only emit
/// numbers (simpler counter) but accept either on the wire.
#[derive(Debug, Clone, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(untagged)]
pub enum RequestId {
    Number(u64),
    String(String),
}

impl RequestId {
    pub fn from_u64(n: u64) -> Self {
        RequestId::Number(n)
    }
}

/// All 12 ACP v1 method names enumerated in the spec §2.3 table.
/// Kept as a free-standing enum (not tied to params) so callers can
/// pattern-match on `method` without already knowing the variant.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Method {
    Initialize,
    Authenticate,
    SessionNew,
    SessionLoad,
    SessionResume,
    SessionPrompt,
    SessionCancel,
    SessionClose,
    SessionUpdate,
    SessionRequestPermission,
    FsReadTextFile,
    FsWriteTextFile,
    TerminalCreate,
}

impl Method {
    pub const fn as_str(self) -> &'static str {
        match self {
            Method::Initialize => "initialize",
            Method::Authenticate => "authenticate",
            Method::SessionNew => "session/new",
            Method::SessionLoad => "session/load",
            Method::SessionResume => "session/resume",
            Method::SessionPrompt => "session/prompt",
            Method::SessionCancel => "session/cancel",
            Method::SessionClose => "session/close",
            Method::SessionUpdate => "session/update",
            Method::SessionRequestPermission => "session/request_permission",
            Method::FsReadTextFile => "fs/read_text_file",
            Method::FsWriteTextFile => "fs/write_text_file",
            Method::TerminalCreate => "terminal/create",
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ClientInfo {
    pub name: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub title: Option<String>,
    pub version: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct FsCapabilities {
    pub read_text_file: bool,
    pub write_text_file: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct ClientCapabilities {
    pub fs: FsCapabilities,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub terminal: Option<bool>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct InitializeParams {
    pub protocol_version: u32,
    pub client_capabilities: ClientCapabilities,
    pub client_info: ClientInfo,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AuthMethod {
    pub id: String,
    pub name: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub description: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct InitializeResult {
    pub protocol_version: u32,
    #[serde(default)]
    pub agent_capabilities: Value,
    #[serde(default)]
    pub agent_info: Value,
    #[serde(default)]
    pub auth_methods: Vec<AuthMethod>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AuthenticateParams {
    pub method_id: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct McpServerSpec {
    pub name: String,
    pub command: String,
    #[serde(default)]
    pub args: Vec<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub env: Option<Value>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SessionNewParams {
    pub cwd: String,
    /// ACP 어댑터 v0.39+ 는 `mcpServers` 를 *required array* 로 검증한다.
    /// None / 누락 / null 모두 -32602 Invalid params 응답을 받는다.
    /// 따라서 None 일 때도 직렬화에 포함시켜야 하며, serialize_with 로
    /// `null` 대신 `[]` 를 내보낸다.
    #[serde(default, serialize_with = "serialize_mcp_servers")]
    pub mcp_servers: Option<Vec<McpServerSpec>>,
}

fn serialize_mcp_servers<S>(
    value: &Option<Vec<McpServerSpec>>,
    serializer: S,
) -> Result<S::Ok, S::Error>
where
    S: serde::Serializer,
{
    use serde::ser::SerializeSeq;
    let slice: &[McpServerSpec] = value.as_deref().unwrap_or(&[]);
    let mut seq = serializer.serialize_seq(Some(slice.len()))?;
    for item in slice {
        seq.serialize_element(item)?;
    }
    seq.end()
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SessionNewResult {
    pub session_id: SessionId,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SessionLoadParams {
    pub session_id: SessionId,
    pub cwd: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SessionResumeParams {
    pub session_id: SessionId,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum ContentBlock {
    Text {
        text: String,
    },
    #[serde(other)]
    Other,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SessionPromptParams {
    pub session_id: SessionId,
    pub prompt: Vec<ContentBlock>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum StopReason {
    EndTurn,
    Cancelled,
    MaxTokens,
    MaxTurns,
    Refusal,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SessionPromptResult {
    pub stop_reason: StopReason,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SessionCancelParams {
    pub session_id: SessionId,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SessionCloseParams {
    pub session_id: SessionId,
}

/// `session/update` notification (agent → client). Includes the session id
/// and a tagged `update` payload whose `sessionUpdate` field discriminates.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SessionUpdateParams {
    pub session_id: SessionId,
    pub update: SessionUpdate,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "sessionUpdate", rename_all = "snake_case")]
pub enum SessionUpdate {
    Plan(PlanUpdate),
    AgentMessageChunk(AgentMessageChunk),
    ToolCall(ToolCallStart),
    ToolCallUpdate(ToolCallUpdate),
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PlanEntry {
    pub content: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub priority: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub status: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PlanUpdate {
    pub entries: Vec<PlanEntry>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AgentMessageChunk {
    pub content: ContentBlock,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ToolCallStart {
    pub tool_call_id: String,
    pub title: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub kind: Option<String>,
    #[serde(default)]
    pub status: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ToolCallUpdate {
    pub tool_call_id: String,
    pub status: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub content: Option<Value>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RequestPermissionParams {
    pub session_id: SessionId,
    pub tool_call_id: String,
    #[serde(default)]
    pub summary: String,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum PermissionDecision {
    Allow,
    AllowOnce,
    Deny,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RequestPermissionResult {
    pub decision: PermissionDecision,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FsReadTextFileParams {
    pub path: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub line: Option<u32>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub limit: Option<u32>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FsReadTextFileResult {
    pub content: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FsWriteTextFileParams {
    pub path: String,
    pub content: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TerminalCreateParams {
    pub command: String,
    #[serde(default)]
    pub args: Vec<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub cwd: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TerminalCreateResult {
    pub terminal_id: String,
}

/// JSON-RPC error object.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RpcError {
    pub code: i64,
    pub message: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub data: Option<Value>,
}

/// Top-level JSON-RPC 2.0 request envelope sent to the agent.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Request {
    pub jsonrpc: String,
    pub id: RequestId,
    pub method: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub params: Option<Value>,
}

impl Request {
    pub fn new<P: Serialize>(id: RequestId, method: &str, params: &P) -> serde_json::Result<Self> {
        Ok(Request {
            jsonrpc: "2.0".to_string(),
            id,
            method: method.to_string(),
            params: Some(serde_json::to_value(params)?),
        })
    }
}

/// Top-level JSON-RPC 2.0 response envelope received from the agent.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Response {
    pub jsonrpc: String,
    pub id: RequestId,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub result: Option<Value>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub error: Option<RpcError>,
}

/// Top-level JSON-RPC 2.0 notification envelope (no `id`).
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Notification {
    pub jsonrpc: String,
    pub method: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub params: Option<Value>,
}

impl Notification {
    pub fn new<P: Serialize>(method: &str, params: &P) -> serde_json::Result<Self> {
        Ok(Notification {
            jsonrpc: "2.0".to_string(),
            method: method.to_string(),
            params: Some(serde_json::to_value(params)?),
        })
    }
}

/// Untagged envelope for whatever the transport delivers next. Order of
/// variants matters: serde tries each in turn and picks the first match.
/// `Request` requires both `id` and `method`; `Notification` requires
/// `method` and has no `id`; `Response` requires `id` and no `method`.
/// Putting Request first ensures requests aren't accidentally captured as
/// responses (whose `result`/`error` are both optional).
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(untagged)]
pub enum RawMessage {
    Request(Request),
    Notification(Notification),
    Response(Response),
}

#[cfg(test)]
mod tests {
    use super::*;
    use pretty_assertions::assert_eq;
    use serde_json::json;

    #[test]
    fn method_name_table_matches_spec() {
        // All 12 method names from S-AI-ACP-001 §2.3 plus terminal/create.
        assert_eq!(Method::Initialize.as_str(), "initialize");
        assert_eq!(Method::Authenticate.as_str(), "authenticate");
        assert_eq!(Method::SessionNew.as_str(), "session/new");
        assert_eq!(Method::SessionLoad.as_str(), "session/load");
        assert_eq!(Method::SessionResume.as_str(), "session/resume");
        assert_eq!(Method::SessionPrompt.as_str(), "session/prompt");
        assert_eq!(Method::SessionCancel.as_str(), "session/cancel");
        assert_eq!(Method::SessionClose.as_str(), "session/close");
        assert_eq!(Method::SessionUpdate.as_str(), "session/update");
        assert_eq!(
            Method::SessionRequestPermission.as_str(),
            "session/request_permission"
        );
        assert_eq!(Method::FsReadTextFile.as_str(), "fs/read_text_file");
        assert_eq!(Method::FsWriteTextFile.as_str(), "fs/write_text_file");
        assert_eq!(Method::TerminalCreate.as_str(), "terminal/create");
    }

    #[test]
    fn initialize_params_round_trip() {
        let p = InitializeParams {
            protocol_version: 1,
            client_capabilities: ClientCapabilities {
                fs: FsCapabilities {
                    read_text_file: true,
                    write_text_file: true,
                },
                terminal: Some(false),
            },
            client_info: ClientInfo {
                name: "markspread".into(),
                title: Some("Markspread".into()),
                version: "0.1.0".into(),
            },
        };
        let v = serde_json::to_value(&p).unwrap();
        assert_eq!(v["protocolVersion"], 1);
        assert_eq!(v["clientCapabilities"]["fs"]["readTextFile"], true);
        assert_eq!(v["clientInfo"]["name"], "markspread");
        let back: InitializeParams = serde_json::from_value(v).unwrap();
        assert_eq!(back.protocol_version, 1);
    }

    #[test]
    fn initialize_result_accepts_unknown_caps() {
        let raw = json!({
            "protocolVersion": 1,
            "agentCapabilities": { "loadSession": true, "unknownNewField": "x" },
            "agentInfo": { "name": "claude" },
            "authMethods": [
                { "id": "subscription", "name": "Subscription" }
            ]
        });
        let r: InitializeResult = serde_json::from_value(raw).unwrap();
        assert_eq!(r.protocol_version, 1);
        assert_eq!(r.auth_methods.len(), 1);
        assert_eq!(r.auth_methods[0].id, "subscription");
    }

    #[test]
    fn session_new_params_serialise_camel_case_none_emits_empty_array() {
        // ACP 어댑터 v0.39+ schema 가 mcpServers 를 required array 로 검증
        // → None 이라도 `[]` 로 직렬화해서 spawn 직후 session/new 가 reject
        //   되지 않도록 함.
        let p = SessionNewParams {
            cwd: "/tmp/workspace".into(),
            mcp_servers: None,
        };
        let v = serde_json::to_value(&p).unwrap();
        assert_eq!(v["cwd"], "/tmp/workspace");
        assert!(v["mcpServers"].is_array());
        assert_eq!(v["mcpServers"].as_array().unwrap().len(), 0);
    }

    #[test]
    fn session_new_params_serialise_some_vec() {
        let p = SessionNewParams {
            cwd: "/tmp/ws".into(),
            mcp_servers: Some(vec![]),
        };
        let v = serde_json::to_value(&p).unwrap();
        assert!(v["mcpServers"].is_array());
        assert_eq!(v["mcpServers"].as_array().unwrap().len(), 0);
    }

    #[test]
    fn session_new_result_extracts_session_id() {
        let raw = json!({ "sessionId": "sess-abc" });
        let r: SessionNewResult = serde_json::from_value(raw).unwrap();
        assert_eq!(r.session_id.as_str(), "sess-abc");
    }

    #[test]
    fn session_prompt_params_with_text_block() {
        let p = SessionPromptParams {
            session_id: SessionId("s1".into()),
            prompt: vec![ContentBlock::Text {
                text: "hi\nthere".into(),
            }],
        };
        let v = serde_json::to_value(&p).unwrap();
        assert_eq!(v["sessionId"], "s1");
        assert_eq!(v["prompt"][0]["type"], "text");
        assert_eq!(v["prompt"][0]["text"], "hi\nthere");
    }

    #[test]
    fn session_update_dispatches_on_session_update_field() {
        let chunk_json = json!({
            "sessionUpdate": "agent_message_chunk",
            "content": { "type": "text", "text": "hello" }
        });
        let u: SessionUpdate = serde_json::from_value(chunk_json).unwrap();
        match u {
            SessionUpdate::AgentMessageChunk(c) => match c.content {
                ContentBlock::Text { text } => assert_eq!(text, "hello"),
                _ => panic!("expected text block"),
            },
            _ => panic!("expected chunk variant"),
        }

        let plan_json = json!({
            "sessionUpdate": "plan",
            "entries": [{ "content": "step 1", "status": "pending" }]
        });
        let u: SessionUpdate = serde_json::from_value(plan_json).unwrap();
        match u {
            SessionUpdate::Plan(p) => {
                assert_eq!(p.entries.len(), 1);
                assert_eq!(p.entries[0].content, "step 1");
            }
            _ => panic!("expected plan variant"),
        }

        let tool_json = json!({
            "sessionUpdate": "tool_call",
            "toolCallId": "tc-1",
            "title": "read file",
            "kind": "fs",
            "status": "pending"
        });
        let u: SessionUpdate = serde_json::from_value(tool_json).unwrap();
        match u {
            SessionUpdate::ToolCall(t) => {
                assert_eq!(t.tool_call_id, "tc-1");
                assert_eq!(t.title, "read file");
            }
            _ => panic!("expected tool_call variant"),
        }

        let tool_upd = json!({
            "sessionUpdate": "tool_call_update",
            "toolCallId": "tc-1",
            "status": "completed"
        });
        let u: SessionUpdate = serde_json::from_value(tool_upd).unwrap();
        match u {
            SessionUpdate::ToolCallUpdate(t) => {
                assert_eq!(t.tool_call_id, "tc-1");
                assert_eq!(t.status, "completed");
            }
            _ => panic!("expected tool_call_update variant"),
        }
    }

    #[test]
    fn stop_reason_serialises_snake_case() {
        let r = SessionPromptResult {
            stop_reason: StopReason::EndTurn,
        };
        let v = serde_json::to_value(&r).unwrap();
        assert_eq!(v["stopReason"], "end_turn");
        let cancelled: StopReason = serde_json::from_value(json!("cancelled")).unwrap();
        matches!(cancelled, StopReason::Cancelled);
    }

    #[test]
    fn request_envelope_round_trip() {
        let req = Request::new(
            RequestId::from_u64(1),
            "initialize",
            &InitializeParams {
                protocol_version: 1,
                client_capabilities: ClientCapabilities::default(),
                client_info: ClientInfo {
                    name: "m".into(),
                    title: None,
                    version: "0".into(),
                },
            },
        )
        .unwrap();
        let s = serde_json::to_string(&req).unwrap();
        assert!(s.contains("\"jsonrpc\":\"2.0\""));
        assert!(s.contains("\"id\":1"));
        assert!(s.contains("\"method\":\"initialize\""));
        let back: Request = serde_json::from_str(&s).unwrap();
        assert_eq!(back.method, "initialize");
    }

    #[test]
    fn response_envelope_with_result() {
        let raw = r#"{"jsonrpc":"2.0","id":7,"result":{"sessionId":"abc"}}"#;
        let r: Response = serde_json::from_str(raw).unwrap();
        assert_eq!(r.jsonrpc, "2.0");
        assert!(r.error.is_none());
        assert_eq!(r.result.unwrap()["sessionId"], "abc");
        match r.id {
            RequestId::Number(n) => assert_eq!(n, 7),
            _ => panic!("expected numeric id"),
        }
    }

    #[test]
    fn response_envelope_with_error() {
        let raw =
            r#"{"jsonrpc":"2.0","id":"x","error":{"code":-32601,"message":"method not found"}}"#;
        let r: Response = serde_json::from_str(raw).unwrap();
        let e = r.error.unwrap();
        assert_eq!(e.code, -32601);
        assert_eq!(e.message, "method not found");
        match r.id {
            RequestId::String(s) => assert_eq!(s, "x"),
            _ => panic!("expected string id"),
        }
    }

    #[test]
    fn notification_envelope_without_id() {
        let n = Notification::new(
            "session/cancel",
            &SessionCancelParams {
                session_id: SessionId("s1".into()),
            },
        )
        .unwrap();
        let v = serde_json::to_value(&n).unwrap();
        assert!(v.get("id").is_none());
        assert_eq!(v["method"], "session/cancel");
        assert_eq!(v["params"]["sessionId"], "s1");
    }

    #[test]
    fn raw_message_untagged_dispatch() {
        let req = r#"{"jsonrpc":"2.0","id":1,"method":"initialize","params":{}}"#;
        match serde_json::from_str::<RawMessage>(req).unwrap() {
            RawMessage::Request(r) => assert_eq!(r.method, "initialize"),
            other => panic!("expected request, got {other:?}"),
        }

        let resp = r#"{"jsonrpc":"2.0","id":1,"result":{}}"#;
        match serde_json::from_str::<RawMessage>(resp).unwrap() {
            RawMessage::Response(r) => assert!(r.result.is_some()),
            other => panic!("expected response, got {other:?}"),
        }

        let notif = r#"{"jsonrpc":"2.0","method":"session/update","params":{}}"#;
        match serde_json::from_str::<RawMessage>(notif).unwrap() {
            RawMessage::Notification(n) => assert_eq!(n.method, "session/update"),
            other => panic!("expected notification, got {other:?}"),
        }
    }

    #[test]
    fn permission_decision_round_trip() {
        for d in [
            PermissionDecision::Allow,
            PermissionDecision::AllowOnce,
            PermissionDecision::Deny,
        ] {
            let s = serde_json::to_string(&d).unwrap();
            let back: PermissionDecision = serde_json::from_str(&s).unwrap();
            assert_eq!(d, back);
        }
    }

    #[test]
    fn request_permission_round_trip() {
        let p = RequestPermissionParams {
            session_id: SessionId("s1".into()),
            tool_call_id: "tc".into(),
            summary: "run rm -rf /".into(),
        };
        let v = serde_json::to_value(&p).unwrap();
        assert_eq!(v["sessionId"], "s1");
        assert_eq!(v["toolCallId"], "tc");
        let back: RequestPermissionParams = serde_json::from_value(v).unwrap();
        assert_eq!(back.tool_call_id, "tc");
    }

    #[test]
    fn fs_read_write_round_trip() {
        let p = FsReadTextFileParams {
            path: "/abs/a.md".into(),
            line: Some(10),
            limit: Some(40),
        };
        let v = serde_json::to_value(&p).unwrap();
        assert_eq!(v["path"], "/abs/a.md");
        assert_eq!(v["line"], 10);

        let w = FsWriteTextFileParams {
            path: "/abs/a.md".into(),
            content: "hi".into(),
        };
        let v = serde_json::to_value(&w).unwrap();
        assert_eq!(v["content"], "hi");
    }

    #[test]
    fn terminal_create_round_trip() {
        let p = TerminalCreateParams {
            command: "ls".into(),
            args: vec!["-la".into()],
            cwd: Some("/tmp".into()),
        };
        let v = serde_json::to_value(&p).unwrap();
        assert_eq!(v["command"], "ls");
        assert_eq!(v["args"][0], "-la");
        assert_eq!(v["cwd"], "/tmp");
        let r = TerminalCreateResult {
            terminal_id: "t1".into(),
        };
        let v = serde_json::to_value(&r).unwrap();
        assert_eq!(v["terminalId"], "t1");
    }

    #[test]
    fn session_load_and_resume_round_trip() {
        let l = SessionLoadParams {
            session_id: SessionId("s1".into()),
            cwd: "/tmp".into(),
        };
        let v = serde_json::to_value(&l).unwrap();
        assert_eq!(v["sessionId"], "s1");
        assert_eq!(v["cwd"], "/tmp");

        let r = SessionResumeParams {
            session_id: SessionId("s1".into()),
        };
        let v = serde_json::to_value(&r).unwrap();
        assert_eq!(v["sessionId"], "s1");
    }

    #[test]
    fn authenticate_params_round_trip() {
        let p = AuthenticateParams {
            method_id: "subscription".into(),
        };
        let v = serde_json::to_value(&p).unwrap();
        assert_eq!(v["methodId"], "subscription");
    }

    #[test]
    fn session_close_round_trip() {
        let p = SessionCloseParams {
            session_id: SessionId("s1".into()),
        };
        let v = serde_json::to_value(&p).unwrap();
        assert_eq!(v["sessionId"], "s1");
    }
}
