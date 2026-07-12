// S-AI-ACP-001 §3.5: catalog of known agents and how to spawn them.
//
// NOTE on dead_code: the mutation surface (new_empty/insert/remove/len)
// is exposed for upcoming custom-agent CRUD commands; v1 only ships
// `acp_list_agents`. The methods are exercised by tests in this module.
#![allow(dead_code)]

//
// The registry is keyed by `AgentId` and each entry carries the program
// to spawn plus its credential source. Builtin Claude entries are baked
// in via `default()`; user-registered custom agents (SC-LLM-04) are
// persisted to `agents.json` under the app data dir and merged into the
// in-memory registry at first access + on every `agents_save_custom`.

use std::collections::BTreeMap;
use std::path::{Path, PathBuf};

use serde::{Deserialize, Serialize};

use super::auth::AuthMode;
use super::protocol::AgentId;

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct AgentEntry {
    pub id: AgentId,
    pub name: String,
    /// Argv to spawn — index 0 is the program, the rest are arguments.
    pub command: Vec<String>,
    pub auth: AuthMode,
    /// Optional extra environment variables (e.g. `ANTHROPIC_MODEL`) injected
    /// before spawn. Merged after `resolve_env(auth)` — entry-level overrides
    /// auth-derived keys, so per-agent model routing wins over default.
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub extra_env: Vec<(String, String)>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AgentDescriptor {
    pub id: AgentId,
    pub name: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AgentRegistry {
    entries: BTreeMap<String, AgentEntry>,
}

impl Default for AgentRegistry {
    fn default() -> Self {
        let mut entries = BTreeMap::new();
        // ADR-0015 §3 + Claude Agent SDK subscription auth (ADR-0004):
        // 본 도구는 Claude Code 구독 = ACP 어댑터 + Claude SDK in-process 둘 다 지원.
        // BUILTIN_AGENTS (TS lib/agents/types.ts) 와 ID 일치 — 이전엔 Rust 가 "claude" 하나만
        // 등록해서 TS "claude-subscription" 호출 시 "unknown agent" 에러 발생.

        // claude CLI 자체는 ACP 를 노출하지 않음 (`claude --acp` 미존재).
        // 따라서 모든 Claude entry 는 `@agentclientprotocol/claude-agent-acp` 어댑터
        // (구 `@zed-industries/claude-agent-acp`) 를 npx 로 spawn 한다. 어댑터가
        // 내부적으로 Claude 구독 인증(@anthropic-ai/claude-code SDK) 을 위임한다.

        // claude-subscription: 기본 Sonnet 모델 (어댑터 default)
        let claude_sub = AgentEntry {
            id: AgentId("claude-subscription".into()),
            name: "Claude (Sonnet) — Subscription".into(),
            command: vec![
                "npx".into(),
                "--yes".into(),
                "@agentclientprotocol/claude-agent-acp".into(),
            ],
            auth: AuthMode::ClaudeSubscription,
            extra_env: vec![],
        };
        entries.insert(claude_sub.id.0.clone(), claude_sub);

        // claude-haiku: 동일 어댑터, ANTHROPIC_MODEL 환경변수로 Haiku 선택.
        // (어댑터 CLI 가 model flag 를 제공하지 않으므로 env 로 라우팅.)
        let claude_haiku = AgentEntry {
            id: AgentId("claude-haiku".into()),
            name: "Claude (Haiku) — Subscription".into(),
            command: vec![
                "npx".into(),
                "--yes".into(),
                "@agentclientprotocol/claude-agent-acp".into(),
            ],
            auth: AuthMode::ClaudeSubscription,
            extra_env: vec![(
                "ANTHROPIC_MODEL".to_string(),
                "claude-haiku-4-5".to_string(),
            )],
        };
        entries.insert(claude_haiku.id.0.clone(), claude_haiku);

        // 호환 별칭: 기존 "claude" id 도 유지 (legacy + Zed deprecated shim fallback).
        let claude_legacy = AgentEntry {
            id: AgentId("claude".into()),
            name: "Claude Code".into(),
            command: vec![
                "npx".into(),
                "--yes".into(),
                "@zed-industries/claude-agent-acp".into(),
            ],
            auth: AuthMode::ClaudeSubscription,
            extra_env: vec![],
        };
        entries.insert(claude_legacy.id.0.clone(), claude_legacy);

        AgentRegistry { entries }
    }
}

impl AgentRegistry {
    pub fn new_empty() -> Self {
        AgentRegistry {
            entries: BTreeMap::new(),
        }
    }

    pub fn insert(&mut self, entry: AgentEntry) {
        self.entries.insert(entry.id.0.clone(), entry);
    }

    pub fn remove(&mut self, id: &AgentId) -> Option<AgentEntry> {
        self.entries.remove(&id.0)
    }

    pub fn get(&self, id: &AgentId) -> Option<&AgentEntry> {
        self.entries.get(&id.0)
    }

    pub fn list(&self) -> Vec<AgentDescriptor> {
        self.entries
            .values()
            .map(|e| AgentDescriptor {
                id: e.id.clone(),
                name: e.name.clone(),
            })
            .collect()
    }

    pub fn len(&self) -> usize {
        self.entries.len()
    }

    pub fn is_empty(&self) -> bool {
        self.entries.is_empty()
    }
}

// ─── Custom agent persistence (MAR-1010 / SC-LLM-04) ────────────────────
//
// The renderer registers custom ACP agents through `agents_save_custom`
// with the TS `RegisteredAgent` shape (lib/agents/types.ts). We mirror
// that shape here, persist it as a JSON array in `agents.json` next to
// the other app-data files (same dir as `ai.db` / `settings.json`), and
// convert each record into an `AgentEntry` so `acp_start_session` can
// resolve + spawn it after a restart.

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct CustomAgentTransport {
    /// Argv[0]; further argv lives in `args`.
    pub command: String,
    #[serde(default)]
    pub args: Vec<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub cwd: Option<String>,
    /// Static env injected at spawn time (never secrets — those go via
    /// the keychain-backed `AuthMode` seam).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub env: Option<BTreeMap<String, String>>,
    /// "subscription" | "api-key" | "none" (TS `AgentTransport.auth`).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub auth: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct CustomAgent {
    pub id: String,
    pub label: String,
    /// "acp-external" for user-registered agents; other kinds are stored
    /// verbatim but only `acp-*` kinds become spawnable registry entries.
    pub kind: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub transport: Option<CustomAgentTransport>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub model: Option<String>,
}

/// Where custom agents live on disk. Test builds redirect to a per-process
/// temp file so `cargo test` never reads or clobbers the developer's real
/// `agents.json`.
#[cfg(not(test))]
pub fn custom_agents_path() -> Result<PathBuf, String> {
    dirs::data_local_dir()
        .map(|p| p.join("markspread").join("agents.json"))
        .ok_or_else(|| "could not resolve OS data dir".to_string())
}

#[cfg(test)]
pub fn custom_agents_path() -> Result<PathBuf, String> {
    Ok(std::env::temp_dir().join(format!(
        "markspread-agents-test-{}.json",
        std::process::id()
    )))
}

/// Load persisted custom agents. Missing file (fresh install) and parse
/// failures both degrade to an empty list — a corrupt `agents.json` must
/// never block the builtin agents from loading.
pub fn load_custom_agents(path: &Path) -> Vec<CustomAgent> {
    let raw = match std::fs::read_to_string(path) {
        Ok(raw) => raw,
        Err(_) => return Vec::new(),
    };
    match serde_json::from_str::<Vec<CustomAgent>>(&raw) {
        Ok(list) => list,
        Err(e) => {
            tracing::warn!(error = %e, path = %path.display(), "agents.json parse failed; ignoring");
            Vec::new()
        }
    }
}

/// Atomically persist the custom-agent list (tmp file + rename, same
/// pattern as `ops::write_atomic`). The tmp name is derived from the
/// target file name so writers targeting different files never collide
/// on the intermediate file.
pub fn save_custom_agents(path: &Path, agents: &[CustomAgent]) -> Result<(), String> {
    let parent = path
        .parent()
        .ok_or_else(|| "agents.json path has no parent".to_string())?;
    std::fs::create_dir_all(parent).map_err(|e| format!("create data dir: {e}"))?;
    let bytes =
        serde_json::to_vec_pretty(agents).map_err(|e| format!("serialise agents.json: {e}"))?;
    let tmp = parent.join(format!(
        ".{}.tmp",
        path.file_name()
            .map(|n| n.to_string_lossy().into_owned())
            .unwrap_or_else(|| "agents.json".into())
    ));
    std::fs::write(&tmp, &bytes).map_err(|e| format!("write agents.json tmp: {e}"))?;
    std::fs::rename(&tmp, path).map_err(|e| format!("rename agents.json: {e}"))?;
    Ok(())
}

/// Convert a persisted custom agent into a spawnable registry entry.
/// Returns `None` for non-ACP kinds (the `api-key` lane never spawns a
/// child process) and for records without a usable command.
pub fn entry_from_custom(agent: &CustomAgent) -> Option<AgentEntry> {
    if !agent.kind.starts_with("acp") {
        return None;
    }
    let transport = agent.transport.as_ref()?;
    if transport.command.trim().is_empty() {
        return None;
    }
    let mut command = vec![transport.command.clone()];
    command.extend(transport.args.iter().cloned());
    // "subscription" reuses the Claude subscription token seam. Both
    // "api-key" and "none" map to AuthMode::None: for custom externals we
    // have no keychain account/env-var metadata, so the agent process is
    // expected to handle its own credentials (e.g. `gh auth login`).
    let auth = match transport.auth.as_deref() {
        Some("subscription") => AuthMode::ClaudeSubscription,
        _ => AuthMode::None,
    };
    let extra_env = transport
        .env
        .as_ref()
        .map(|m| m.iter().map(|(k, v)| (k.clone(), v.clone())).collect())
        .unwrap_or_default();
    Some(AgentEntry {
        id: AgentId(agent.id.clone()),
        name: agent.label.clone(),
        command,
        auth,
        extra_env,
    })
}

/// True for ids shipped in `AgentRegistry::default()`. Builtins can never
/// be overwritten or removed through the custom-agent commands.
pub fn is_builtin_id(id: &str) -> bool {
    matches!(id, "claude" | "claude-subscription" | "claude-haiku")
}

#[cfg(test)]
mod tests {
    use super::*;
    use pretty_assertions::assert_eq;

    #[test]
    fn default_registry_includes_claude_code_builtin() {
        let r = AgentRegistry::default();
        let entry = r
            .get(&AgentId("claude".into()))
            .expect("claude builtin missing");
        assert_eq!(entry.name, "Claude Code");
        assert_eq!(entry.auth, AuthMode::ClaudeSubscription);
        assert!(!entry.command.is_empty());
    }

    #[test]
    fn registry_round_trips_through_serde() {
        let mut r = AgentRegistry::default();
        let default_count = r.len();
        r.insert(AgentEntry {
            id: AgentId("codex".into()),
            name: "Codex CLI".into(),
            command: vec!["npx".into(), "codex-acp".into()],
            auth: AuthMode::ApiKey {
                keychain_service: "com.markspread.app".into(),
                account: "ai-keys/byo/openai-default".into(),
                env_var: "OPENAI_API_KEY".into(),
            },
            extra_env: vec![],
        });
        let json = serde_json::to_string(&r).unwrap();
        let back: AgentRegistry = serde_json::from_str(&json).unwrap();
        // default_count builtin agents + 1 codex (default 는 claude-subscription / claude-haiku / claude 셋)
        assert_eq!(back.len(), default_count + 1);
        let codex = back.get(&AgentId("codex".into())).unwrap();
        assert_eq!(codex.name, "Codex CLI");
        match &codex.auth {
            AuthMode::ApiKey { env_var, .. } => assert_eq!(env_var, "OPENAI_API_KEY"),
            other => panic!("expected ApiKey, got {other:?}"),
        }
    }

    #[test]
    fn list_returns_descriptors_in_sorted_order() {
        let mut r = AgentRegistry::new_empty();
        r.insert(AgentEntry {
            id: AgentId("zeta".into()),
            name: "Zeta".into(),
            command: vec!["z".into()],
            auth: AuthMode::None,
            extra_env: vec![],
        });
        r.insert(AgentEntry {
            id: AgentId("alpha".into()),
            name: "Alpha".into(),
            command: vec!["a".into()],
            auth: AuthMode::None,
            extra_env: vec![],
        });
        let listed: Vec<String> = r.list().into_iter().map(|d| d.id.0).collect();
        assert_eq!(listed, vec!["alpha".to_string(), "zeta".to_string()]);
    }

    #[test]
    fn remove_returns_dropped_entry() {
        let mut r = AgentRegistry::default();
        let id = AgentId("claude".into());
        let removed = r.remove(&id).unwrap();
        assert_eq!(removed.id, id);
        // 다른 builtin (claude-subscription, claude-haiku) 는 남아있음.
        assert!(r.get(&id).is_none());
        assert!(r.get(&AgentId("claude-subscription".into())).is_some());
    }

    fn sample_custom(id: &str) -> CustomAgent {
        CustomAgent {
            id: id.into(),
            label: format!("{id} label"),
            kind: "acp-external".into(),
            transport: Some(CustomAgentTransport {
                command: "codex-acp".into(),
                args: vec!["--acp".into()],
                cwd: None,
                env: Some(BTreeMap::from([("FOO".to_string(), "bar".to_string())])),
                auth: Some("none".into()),
            }),
            model: None,
        }
    }

    #[test]
    fn custom_agents_round_trip_through_disk() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("agents.json");
        let agents = vec![sample_custom("codex"), sample_custom("gemini-cli")];
        save_custom_agents(&path, &agents).unwrap();
        let back = load_custom_agents(&path);
        assert_eq!(back, agents);
    }

    #[test]
    fn load_custom_agents_missing_file_yields_empty() {
        let dir = tempfile::tempdir().unwrap();
        assert!(load_custom_agents(&dir.path().join("nope.json")).is_empty());
    }

    #[test]
    fn load_custom_agents_corrupt_file_yields_empty() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("agents.json");
        std::fs::write(&path, "{not json").unwrap();
        assert!(load_custom_agents(&path).is_empty());
    }

    #[test]
    fn entry_from_custom_builds_spawnable_argv() {
        let entry = entry_from_custom(&sample_custom("codex")).unwrap();
        assert_eq!(entry.id, AgentId("codex".into()));
        assert_eq!(entry.name, "codex label");
        assert_eq!(entry.command, vec!["codex-acp".to_string(), "--acp".to_string()]);
        assert_eq!(entry.auth, AuthMode::None);
        assert_eq!(
            entry.extra_env,
            vec![("FOO".to_string(), "bar".to_string())]
        );
    }

    #[test]
    fn entry_from_custom_maps_subscription_auth() {
        let mut agent = sample_custom("sub-agent");
        agent.transport.as_mut().unwrap().auth = Some("subscription".into());
        let entry = entry_from_custom(&agent).unwrap();
        assert_eq!(entry.auth, AuthMode::ClaudeSubscription);
    }

    #[test]
    fn entry_from_custom_rejects_non_acp_and_commandless_records() {
        let mut api_key = sample_custom("api");
        api_key.kind = "api-key".into();
        assert!(entry_from_custom(&api_key).is_none());

        let mut no_transport = sample_custom("bare");
        no_transport.transport = None;
        assert!(entry_from_custom(&no_transport).is_none());

        let mut empty_cmd = sample_custom("empty");
        empty_cmd.transport.as_mut().unwrap().command = "  ".into();
        assert!(entry_from_custom(&empty_cmd).is_none());
    }

    #[test]
    fn is_builtin_id_matches_default_registry() {
        let r = AgentRegistry::default();
        for d in r.list() {
            assert!(is_builtin_id(&d.id.0), "builtin {} not guarded", d.id.0);
        }
        assert!(!is_builtin_id("codex"));
    }

    #[test]
    fn custom_agent_deserialises_ts_registered_agent_shape() {
        // Exact payload shape produced by store/agent-registry.ts
        // `registerCustom` (RegisteredAgent, camelCase).
        let json = r#"{
            "id": "my-agent",
            "label": "My Agent",
            "kind": "acp-external",
            "transport": { "command": "my-acp", "args": ["--stdio"] }
        }"#;
        let agent: CustomAgent = serde_json::from_str(json).unwrap();
        assert_eq!(agent.id, "my-agent");
        let t = agent.transport.as_ref().unwrap();
        assert_eq!(t.command, "my-acp");
        assert_eq!(t.args, vec!["--stdio".to_string()]);
        assert!(t.env.is_none());
        assert!(entry_from_custom(&agent).is_some());
    }
}
