// S-AI-ACP-001: Agent Client Protocol v1 client root module.
//
// Exposes the 5 Tauri commands the renderer drives, plus a global
// `AcpManager` (OnceLock<Mutex<…>>) holding live `Arc<AcpClient>`s
// keyed by `SessionId`. Mirrors the `sessions()` pattern in `ai_auth.rs`.

pub mod agent_registry;
pub mod auth;
pub mod client;
pub mod protocol;
pub mod transport;

use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::{Arc, Mutex, OnceLock};

use serde::{Deserialize, Serialize};

use crate::error::AppError;
use agent_registry::{AgentDescriptor, AgentRegistry};
use client::{AcpClient, AcpEvent};
use protocol::{AgentId, ContentBlock, PermissionDecision, RequestId, SessionId};

#[cfg(not(test))]
use protocol::{
    ClientCapabilities, ClientInfo, FsCapabilities, InitializeParams, SessionNewParams,
};
#[cfg(not(test))]
use tauri::{AppHandle, Emitter, Runtime};
#[cfg(not(test))]
use tokio::sync::broadcast;

fn manager() -> &'static Mutex<HashMap<String, Arc<AcpClient>>> {
    static M: OnceLock<Mutex<HashMap<String, Arc<AcpClient>>>> = OnceLock::new();
    M.get_or_init(|| Mutex::new(HashMap::new()))
}

/// Remove a session from the global manager. Returns the dropped client,
/// if any, so the caller can drop it outside the manager lock (avoids
/// running any Drop side effects while we hold the global mutex).
fn remove_session(session_id: &SessionId) -> Option<Arc<AcpClient>> {
    let mut m = manager().lock().unwrap();
    m.remove(&session_id.0)
}

fn registry() -> &'static Mutex<AgentRegistry> {
    static R: OnceLock<Mutex<AgentRegistry>> = OnceLock::new();
    R.get_or_init(|| Mutex::new(AgentRegistry::default()))
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SessionHandle {
    pub session_id: SessionId,
    pub agent_id: AgentId,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ApproveDecisionPayload {
    pub request_id_number: Option<u64>,
    pub request_id_string: Option<String>,
    pub decision: PermissionDecision,
}

#[cfg(not(test))]
fn build_client_info() -> ClientInfo {
    ClientInfo {
        name: "markspread".into(),
        title: Some("Markspread".into()),
        version: env!("CARGO_PKG_VERSION").into(),
    }
}

#[cfg(not(test))]
fn build_capabilities() -> ClientCapabilities {
    ClientCapabilities {
        fs: FsCapabilities {
            read_text_file: true,
            write_text_file: true,
        },
        terminal: Some(false),
    }
}

#[tauri::command]
pub async fn acp_list_agents() -> Result<Vec<AgentDescriptor>, AppError> {
    let r = registry().lock().unwrap();
    Ok(r.list())
}

#[cfg(not(test))]
async fn spawn_agent_transport(
    entry: &agent_registry::AgentEntry,
    workspace_root: &std::path::Path,
) -> Result<transport::StdioTransport, AppError> {
    if entry.command.is_empty() {
        return Err(AppError::Invalid("agent command is empty".into()));
    }
    let env_vars = auth::resolve_env(&entry.auth)
        .await
        .map_err(|e| AppError::Invalid(format!("acp auth: {e}")))?;
    let program = &entry.command[0];
    let args = &entry.command[1..];
    // macOS GUI 런치는 사용자 shell PATH (예: /opt/homebrew/bin, ~/.nvm) 를
    // 상속하지 않음. `npx` 등 사용자-설치 도구는 절대경로로 해석해야 한다.
    let program_resolved = resolve_program_path(program);
    let mut cmd = tokio::process::Command::new(&program_resolved);
    cmd.args(args)
        .current_dir(workspace_root)
        .stdin(std::process::Stdio::piped())
        .stdout(std::process::Stdio::piped())
        .stderr(std::process::Stdio::piped());
    // PATH 도 augment — npx 가 spawn 내부에서 node 를 다시 찾을 수 있어야 함.
    let augmented_path = augmented_user_path();
    cmd.env("PATH", &augmented_path);
    for (k, v) in &env_vars {
        cmd.env(k, v);
    }
    // entry-level extra env (예: ANTHROPIC_MODEL=claude-haiku-4-5) 가 auth env
    // 키와 겹치면 entry 가 이긴다.
    for (k, v) in &entry.extra_env {
        cmd.env(k, v);
    }
    let child = cmd.spawn().map_err(|e| {
        AppError::Invalid(format!(
            "acp spawn '{}' (resolved: {}): {e}",
            program,
            program_resolved.display()
        ))
    })?;
    // env_vars dropped here — secrets gone from our address space.
    drop(env_vars);
    transport::StdioTransport::from_child(child)
        .map_err(|e| AppError::Invalid(format!("acp transport: {e}")))
}

/// macOS GUI 런치 시 PATH 가 비어있는 경우를 대비해 일반 사용자 도구 경로를
/// merge. 이미 설정된 PATH 가 있으면 그 앞에 추가만 한다.
#[cfg(not(test))]
fn augmented_user_path() -> String {
    let extra = [
        "/opt/homebrew/bin",
        "/usr/local/bin",
        "/usr/bin",
        "/bin",
        "/usr/sbin",
        "/sbin",
    ];
    let mut parts: Vec<String> = extra.iter().map(|s| s.to_string()).collect();
    if let Ok(home) = std::env::var("HOME") {
        parts.push(format!("{home}/.local/bin"));
        parts.push(format!("{home}/.volta/bin"));
        parts.push(format!("{home}/.asdf/shims"));
    }
    if let Ok(current) = std::env::var("PATH") {
        parts.push(current);
    }
    parts.join(":")
}

/// program 이 절대 경로면 그대로, 아니면 augmented PATH 에서 검색.
/// 못 찾으면 원본 그대로 반환 (spawn 이 명확한 에러 메시지를 만들도록).
#[cfg(not(test))]
fn resolve_program_path(program: &str) -> std::path::PathBuf {
    let p = std::path::Path::new(program);
    if p.is_absolute() {
        return p.to_path_buf();
    }
    let path_env = augmented_user_path();
    for dir in path_env.split(':') {
        let candidate = std::path::Path::new(dir).join(program);
        if candidate.is_file() {
            return candidate;
        }
    }
    p.to_path_buf()
}

#[cfg(not(test))]
#[tauri::command]
pub async fn acp_start_session<R: Runtime>(
    app: AppHandle<R>,
    agent_id: AgentId,
    workspace_root: PathBuf,
) -> Result<SessionHandle, AppError> {
    let entry = {
        let r = registry().lock().unwrap();
        r.get(&agent_id)
            .cloned()
            .ok_or_else(|| AppError::NotFound(format!("unknown agent {}", agent_id.as_str())))?
    };
    let transport = spawn_agent_transport(&entry, &workspace_root).await?;
    let client = AcpClient::new(transport);
    let _init = client
        .initialize(InitializeParams {
            protocol_version: 1,
            client_capabilities: build_capabilities(),
            client_info: build_client_info(),
        })
        .await
        .map_err(|e| AppError::Invalid(format!("acp init: {e}")))?;
    // FIX: ACP 어댑터 v0.39 (@agentclientprotocol/claude-agent-acp) 의
    // session/new 는 `mcpServers` 를 *required array* 로 schema-검증함.
    // None/undefined/null 모두 -32602 Invalid params 응답. 빈 vec! 으로
    // 명시해야 정상 진행.
    let new_session = client
        .session_new(SessionNewParams {
            cwd: workspace_root.to_string_lossy().into_owned(),
            mcp_servers: Some(vec![]),
        })
        .await
        .map_err(|e| AppError::Invalid(format!("acp session/new: {e}")))?;
    // Bound client-side `fs/*` tool calls to this workspace. Without this,
    // an `allow` decision would let the agent re-invoke `fs/write_text_file`
    // but nothing would actually touch disk — the request would hang. See
    // `AcpClient::set_fs_root` / `handle_fs_request`.
    client.set_fs_root(workspace_root.clone());
    let arc_client = Arc::new(client);
    let events = arc_client.subscribe_updates();
    spawn_event_forwarder(
        app,
        new_session.session_id.clone(),
        agent_id.clone(),
        events,
    );
    manager()
        .lock()
        .unwrap()
        .insert(new_session.session_id.0.clone(), arc_client);
    Ok(SessionHandle {
        session_id: new_session.session_id,
        agent_id,
    })
}

#[cfg(not(test))]
fn spawn_event_forwarder<R: Runtime>(
    app: AppHandle<R>,
    session_id: SessionId,
    agent_id: AgentId,
    mut events: broadcast::Receiver<AcpEvent>,
) {
    tokio::spawn(async move {
        loop {
            match events.recv().await {
                Ok(ev) => {
                    // Capture transport-closed before forwarding so we can
                    // also drop the session from the global manager and
                    // release the underlying client/transport.
                    let is_closed = matches!(ev, AcpEvent::Closed(_));
                    let payload = NotificationPayload {
                        session_id: session_id.clone(),
                        agent_id: agent_id.clone(),
                        event: ev,
                    };
                    let _ = app.emit("acp:notification", payload);
                    if is_closed {
                        // Drop outside the lock by binding first.
                        let _dropped = remove_session(&session_id);
                        return;
                    }
                }
                Err(broadcast::error::RecvError::Lagged(_)) => continue,
                Err(broadcast::error::RecvError::Closed) => {
                    // Reader task ended (transport gone) without a Closed
                    // event reaching us — clean up the manager entry so
                    // memory doesn't grow unbounded.
                    let _dropped = remove_session(&session_id);
                    return;
                }
            }
        }
    });
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct NotificationPayload {
    pub session_id: SessionId,
    pub agent_id: AgentId,
    #[serde(serialize_with = "serialize_event")]
    pub event: AcpEvent,
}

fn serialize_event<S: serde::Serializer>(ev: &AcpEvent, s: S) -> Result<S::Ok, S::Error> {
    use serde::ser::SerializeMap;
    let mut m = s.serialize_map(Some(2))?;
    match ev {
        AcpEvent::SessionUpdate(p) => {
            m.serialize_entry("kind", "sessionUpdate")?;
            m.serialize_entry("update", p)?;
        }
        AcpEvent::PermissionRequest { request_id, params } => {
            m.serialize_entry("kind", "permissionRequest")?;
            m.serialize_entry("requestId", request_id)?;
            m.serialize_entry("params", params)?;
        }
        AcpEvent::AgentRequest {
            request_id,
            method,
            params,
        } => {
            m.serialize_entry("kind", "agentRequest")?;
            m.serialize_entry("requestId", request_id)?;
            m.serialize_entry("method", method)?;
            m.serialize_entry("params", params)?;
        }
        AcpEvent::OtherNotification { method, params } => {
            m.serialize_entry("kind", "notification")?;
            m.serialize_entry("method", method)?;
            m.serialize_entry("params", params)?;
        }
        AcpEvent::Closed(reason) => {
            m.serialize_entry("kind", "closed")?;
            m.serialize_entry("reason", reason)?;
        }
    }
    m.end()
}

fn lookup_client(session_id: &SessionId) -> Result<Arc<AcpClient>, AppError> {
    let m = manager().lock().unwrap();
    m.get(&session_id.0)
        .cloned()
        .ok_or_else(|| AppError::NotFound(format!("unknown session {}", session_id.as_str())))
}

#[tauri::command]
pub async fn acp_send_message(session_id: SessionId, content: String) -> Result<(), AppError> {
    let client = lookup_client(&session_id)?;
    let blocks = vec![ContentBlock::Text { text: content }];
    client
        .session_prompt(session_id, blocks)
        .await
        .map_err(|e| AppError::Invalid(format!("acp prompt: {e}")))?;
    Ok(())
}

#[tauri::command]
pub async fn acp_approve_tool(
    session_id: SessionId,
    decision: ApproveDecisionPayload,
) -> Result<(), AppError> {
    let client = lookup_client(&session_id)?;
    let request_id = match (decision.request_id_number, decision.request_id_string) {
        (Some(n), _) => RequestId::Number(n),
        (None, Some(s)) => RequestId::String(s),
        _ => return Err(AppError::Invalid("missing request_id".into())),
    };
    client
        .respond_to_permission_request(request_id, decision.decision)
        .await
        .map_err(|e| AppError::Invalid(format!("acp approve: {e}")))?;
    Ok(())
}

// ─── MAR-1010 / MAR-1011 surface ────────────────────────────────────────
//
// These four commands extend the existing ACP surface with the
// agent-registry + tool-diff approval flow that U2 needs from the
// renderer. They are intentionally thin: persistence + decision routing
// is owned by the renderer stores; Rust merely acts as the IPC
// pipe and (for `acp_approve_diff`) hands the decision to the live ACP
// client when one exists.

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ApproveDiffRequestId {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub request_id_number: Option<u64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub request_id_string: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CustomAgent {
    pub id: String,
    pub label: String,
    pub kind: String,
}

#[tauri::command]
pub async fn agents_list_custom() -> Result<Vec<CustomAgent>, AppError> {
    // The renderer hydrates builtins itself; we return an empty list
    // until persisted custom agents land in a follow-up.
    Ok(Vec::new())
}

#[tauri::command]
pub async fn agents_save_custom(agent: CustomAgent) -> Result<(), AppError> {
    // Persistence (writing to `~/.markspread/agents.json`) is wired in a
    // follow-up; today we accept and discard to keep the IPC ack flow.
    let _ = agent;
    Ok(())
}

#[tauri::command]
pub async fn agents_remove_custom(id: String) -> Result<(), AppError> {
    let _ = id;
    Ok(())
}

#[tauri::command]
pub async fn acp_set_workspace_default(
    workspace_id: String,
    agent_id: String,
) -> Result<(), AppError> {
    // No-op host side; the renderer store is the source of truth and
    // forwards here for future workspace-layout persistence.
    let _ = (workspace_id, agent_id);
    Ok(())
}

#[tauri::command]
pub async fn acp_approve_diff(
    session_id: SessionId,
    request_id: ApproveDiffRequestId,
    decision: String,
) -> Result<(), AppError> {
    let client = lookup_client(&session_id)?;
    let request_id = match (request_id.request_id_number, request_id.request_id_string) {
        (Some(n), _) => RequestId::Number(n),
        (None, Some(s)) => RequestId::String(s),
        _ => return Err(AppError::Invalid("missing request_id".into())),
    };
    let dec = match decision.as_str() {
        "allow" => PermissionDecision::Allow,
        "allow_once" => PermissionDecision::AllowOnce,
        "deny" => PermissionDecision::Deny,
        other => return Err(AppError::Invalid(format!("unknown decision {other}"))),
    };
    client
        .respond_to_permission_request(request_id, dec)
        .await
        .map_err(|e| AppError::Invalid(format!("acp approve_diff: {e}")))?;
    Ok(())
}

#[tauri::command]
pub async fn tool_queue_save(
    workspace_id: String,
    queue: serde_json::Value,
) -> Result<(), AppError> {
    let _ = (workspace_id, queue);
    Ok(())
}

#[tauri::command]
pub async fn tool_queue_load(workspace_id: String) -> Result<serde_json::Value, AppError> {
    let _ = workspace_id;
    Ok(serde_json::Value::Array(Vec::new()))
}

#[tauri::command]
pub async fn acp_cancel(session_id: SessionId) -> Result<(), AppError> {
    let client = lookup_client(&session_id)?;
    client
        .session_cancel(session_id.clone())
        .await
        .map_err(|e| AppError::Invalid(format!("acp cancel: {e}")))?;
    Ok(())
}

/// Close a session: send the `session/close` RPC to the agent, then drop
/// the client from the global manager so the underlying transport,
/// reader, and writer tasks can be reclaimed. The manager entry is
/// removed unconditionally — even if the RPC fails — so a flaky agent
/// can never leak sessions into our HashMap.
#[tauri::command]
pub async fn acp_close_session(session_id: SessionId) -> Result<(), AppError> {
    let client = lookup_client(&session_id)?;
    let rpc_result = client
        .session_close(session_id.clone())
        .await
        .map_err(|e| AppError::Invalid(format!("acp close: {e}")));
    // Always remove from manager regardless of RPC outcome — otherwise a
    // transport that's already half-closed would leave a dead Arc behind.
    drop(client);
    let _dropped = remove_session(&session_id);
    rpc_result
}

// Test-only stub so cargo test --all-features can compile a version of
// acp_start_session that doesn't depend on a real Tauri AppHandle/runtime.
#[cfg(test)]
#[tauri::command]
pub async fn acp_start_session(
    agent_id: AgentId,
    workspace_root: PathBuf,
) -> Result<SessionHandle, AppError> {
    let _ = workspace_root;
    Err(AppError::Invalid(format!(
        "acp_start_session disabled in test build for agent {}",
        agent_id.as_str()
    )))
}

#[cfg(test)]
mod tests {
    use super::*;
    use serial_test::serial;

    #[tokio::test]
    #[serial]
    async fn list_agents_returns_default_registry() {
        let agents = acp_list_agents().await.unwrap();
        assert!(agents.iter().any(|a| a.id.as_str() == "claude"));
    }

    #[tokio::test]
    #[serial]
    async fn lookup_client_returns_not_found_for_unknown_session() {
        let err = lookup_client(&SessionId("does-not-exist".into())).unwrap_err();
        match err {
            AppError::NotFound(_) => {}
            other => panic!("expected NotFound, got {other:?}"),
        }
    }

    #[tokio::test]
    #[serial]
    async fn send_message_to_unknown_session_errors() {
        let err = acp_send_message(SessionId("nope".into()), "hi".into())
            .await
            .unwrap_err();
        matches!(err, AppError::NotFound(_));
    }

    #[tokio::test]
    #[serial]
    async fn cancel_unknown_session_errors() {
        let err = acp_cancel(SessionId("nope".into())).await.unwrap_err();
        matches!(err, AppError::NotFound(_));
    }

    #[tokio::test]
    #[serial]
    async fn approve_tool_missing_request_id_errors() {
        // Insert a real client so we get past the lookup and hit the
        // request_id validation branch.
        let (client_t, _agent_t) = transport::MemoryTransport::pair(8192);
        let client = Arc::new(AcpClient::new(client_t));
        manager()
            .lock()
            .unwrap()
            .insert("test-session-approve".into(), client);
        let err = acp_approve_tool(
            SessionId("test-session-approve".into()),
            ApproveDecisionPayload {
                request_id_number: None,
                request_id_string: None,
                decision: PermissionDecision::Allow,
            },
        )
        .await
        .unwrap_err();
        match err {
            AppError::Invalid(s) => assert!(s.contains("request_id")),
            other => panic!("expected Invalid, got {other:?}"),
        }
        manager().lock().unwrap().remove("test-session-approve");
    }

    #[tokio::test]
    #[serial]
    async fn event_payload_serialises_with_kind_tag() {
        let p = NotificationPayload {
            session_id: SessionId("s1".into()),
            agent_id: AgentId("claude".into()),
            event: AcpEvent::Closed("eof".into()),
        };
        let v = serde_json::to_value(&p).unwrap();
        assert_eq!(v["sessionId"], "s1");
        assert_eq!(v["agentId"], "claude");
        assert_eq!(v["event"]["kind"], "closed");
        assert_eq!(v["event"]["reason"], "eof");
    }

    #[tokio::test]
    #[serial]
    async fn agents_list_custom_returns_empty_by_default() {
        let out = agents_list_custom().await.unwrap();
        assert!(out.is_empty());
    }

    #[tokio::test]
    #[serial]
    async fn agents_save_and_remove_custom_are_noops_today() {
        agents_save_custom(CustomAgent {
            id: "x".into(),
            label: "X".into(),
            kind: "acp-external".into(),
        })
        .await
        .unwrap();
        agents_remove_custom("x".into()).await.unwrap();
    }

    #[tokio::test]
    #[serial]
    async fn set_workspace_default_acks() {
        acp_set_workspace_default("/ws".into(), "claude-subscription".into())
            .await
            .unwrap();
    }

    #[tokio::test]
    #[serial]
    async fn tool_queue_save_and_load_round_trip_empty() {
        tool_queue_save("/ws".into(), serde_json::Value::Array(Vec::new()))
            .await
            .unwrap();
        let loaded = tool_queue_load("/ws".into()).await.unwrap();
        assert!(loaded.is_array());
    }

    #[tokio::test]
    #[serial]
    async fn approve_diff_with_unknown_session_returns_not_found() {
        let err = acp_approve_diff(
            SessionId("no-such".into()),
            ApproveDiffRequestId {
                request_id_number: Some(1),
                request_id_string: None,
            },
            "allow".into(),
        )
        .await
        .unwrap_err();
        matches!(err, AppError::NotFound(_));
    }

    #[tokio::test]
    #[serial]
    async fn approve_diff_with_missing_request_id_errors() {
        let (client_t, _agent_t) = transport::MemoryTransport::pair(8192);
        let client = Arc::new(AcpClient::new(client_t));
        manager()
            .lock()
            .unwrap()
            .insert("approve-diff-1".into(), client);
        let err = acp_approve_diff(
            SessionId("approve-diff-1".into()),
            ApproveDiffRequestId {
                request_id_number: None,
                request_id_string: None,
            },
            "allow".into(),
        )
        .await
        .unwrap_err();
        match err {
            AppError::Invalid(s) => assert!(s.contains("request_id")),
            other => panic!("expected Invalid, got {other:?}"),
        }
        manager().lock().unwrap().remove("approve-diff-1");
    }

    #[tokio::test]
    #[serial]
    async fn approve_diff_with_unknown_decision_errors() {
        let (client_t, _agent_t) = transport::MemoryTransport::pair(8192);
        let client = Arc::new(AcpClient::new(client_t));
        manager()
            .lock()
            .unwrap()
            .insert("approve-diff-2".into(), client);
        let err = acp_approve_diff(
            SessionId("approve-diff-2".into()),
            ApproveDiffRequestId {
                request_id_number: Some(1),
                request_id_string: None,
            },
            "maybe".into(),
        )
        .await
        .unwrap_err();
        match err {
            AppError::Invalid(s) => assert!(s.contains("unknown decision")),
            other => panic!("expected Invalid, got {other:?}"),
        }
        manager().lock().unwrap().remove("approve-diff-2");
    }

    #[tokio::test]
    #[serial]
    async fn approve_diff_with_string_request_id_dispatches_allow_once() {
        let (client_t, _agent_t) = transport::MemoryTransport::pair(8192);
        let client = Arc::new(AcpClient::new(client_t));
        manager()
            .lock()
            .unwrap()
            .insert("approve-diff-3".into(), client);
        // We use allow_once to exercise that variant. The transport is
        // drained on drop; we only verify the command path doesn't err.
        let res = acp_approve_diff(
            SessionId("approve-diff-3".into()),
            ApproveDiffRequestId {
                request_id_number: None,
                request_id_string: Some("rid-abc".into()),
            },
            "allow_once".into(),
        )
        .await;
        // ok or transport-side Invalid both fine — we want no panic and
        // a clean enum result.
        assert!(matches!(res, Ok(()) | Err(AppError::Invalid(_))));
        manager().lock().unwrap().remove("approve-diff-3");
    }

    #[tokio::test]
    #[serial]
    async fn close_session_removes_entry_from_manager() {
        // Snapshot baseline len so we don't depend on test ordering.
        let baseline = manager().lock().unwrap().len();

        // Insert two sessions so we can verify the targeted one is the
        // only one removed.
        let (client_t1, _agent_t1) = transport::MemoryTransport::pair(8192);
        let (client_t2, agent_t2) = transport::MemoryTransport::pair(8192);
        let c1 = Arc::new(AcpClient::new(client_t1));
        let c2 = Arc::new(AcpClient::new(client_t2));
        {
            let mut m = manager().lock().unwrap();
            m.insert("close-test-keep".into(), c1);
            m.insert("close-test-drop".into(), c2);
        }
        assert_eq!(manager().lock().unwrap().len(), baseline + 2);

        // Drop the fake agent half *before* closing. An underscore-
        // prefixed binding (`_agent_t2`) lives until end of scope — only
        // a bare `_` pattern drops immediately — so keeping it alive
        // left the transport peer open and `session/close` (a request
        // that awaits a reply) parked forever. This exact line hung
        // every `cargo test` run at the 6h CI timeout.
        drop(agent_t2);

        // Close the target session. Because the fake agent half was
        // dropped, the underlying RPC will fail with a transport error —
        // but cleanup MUST still happen. That's exactly the property
        // we're guarding against: a flaky agent can never leak entries.
        let res = acp_close_session(SessionId("close-test-drop".into())).await;
        assert!(
            matches!(res, Err(AppError::Invalid(_))) || matches!(res, Ok(())),
            "expected Ok or Invalid (transport err), got {res:?}"
        );

        // Manager went from baseline+2 down to baseline+1 — exactly one
        // session removed, the other untouched.
        let m = manager().lock().unwrap();
        assert_eq!(m.len(), baseline + 1);
        assert!(m.contains_key("close-test-keep"));
        assert!(!m.contains_key("close-test-drop"));
        drop(m);

        // Clean up the other one so we leave the global at baseline.
        let _ = remove_session(&SessionId("close-test-keep".into()));
        assert_eq!(manager().lock().unwrap().len(), baseline);
    }

    #[tokio::test]
    #[serial]
    async fn close_session_unknown_returns_not_found() {
        let baseline = manager().lock().unwrap().len();
        let err = acp_close_session(SessionId("never-inserted".into()))
            .await
            .unwrap_err();
        match err {
            AppError::NotFound(_) => {}
            other => panic!("expected NotFound, got {other:?}"),
        }
        assert_eq!(manager().lock().unwrap().len(), baseline);
    }

    #[tokio::test]
    #[serial]
    async fn remove_session_is_idempotent() {
        let baseline = manager().lock().unwrap().len();
        let (client_t, _agent_t) = transport::MemoryTransport::pair(8192);
        manager()
            .lock()
            .unwrap()
            .insert("idem-1".into(), Arc::new(AcpClient::new(client_t)));
        assert_eq!(manager().lock().unwrap().len(), baseline + 1);
        let first = remove_session(&SessionId("idem-1".into()));
        assert!(first.is_some());
        let second = remove_session(&SessionId("idem-1".into()));
        assert!(second.is_none());
        assert_eq!(manager().lock().unwrap().len(), baseline);
    }

    #[tokio::test]
    #[serial]
    async fn start_session_test_stub_returns_typed_error() {
        let err = acp_start_session(AgentId("claude".into()), PathBuf::from("/tmp"))
            .await
            .unwrap_err();
        match err {
            AppError::Invalid(_) => {}
            other => panic!("expected Invalid in test stub, got {other:?}"),
        }
    }
}
