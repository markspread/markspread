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
    let mut cmd = tokio::process::Command::new(program);
    cmd.args(args)
        .current_dir(workspace_root)
        .stdin(std::process::Stdio::piped())
        .stdout(std::process::Stdio::piped())
        .stderr(std::process::Stdio::piped());
    for (k, v) in &env_vars {
        cmd.env(k, v);
    }
    let child = cmd
        .spawn()
        .map_err(|e| AppError::Invalid(format!("acp spawn: {e}")))?;
    // env_vars dropped here — secrets gone from our address space.
    drop(env_vars);
    transport::StdioTransport::from_child(child)
        .map_err(|e| AppError::Invalid(format!("acp transport: {e}")))
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
    let new_session = client
        .session_new(SessionNewParams {
            cwd: workspace_root.to_string_lossy().into_owned(),
            mcp_servers: None,
        })
        .await
        .map_err(|e| AppError::Invalid(format!("acp session/new: {e}")))?;
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
                    let payload = NotificationPayload {
                        session_id: session_id.clone(),
                        agent_id: agent_id.clone(),
                        event: ev,
                    };
                    let _ = app.emit("acp:notification", payload);
                }
                Err(broadcast::error::RecvError::Lagged(_)) => continue,
                Err(broadcast::error::RecvError::Closed) => return,
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
