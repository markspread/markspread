// S-AI-ACP-001 §3.5: catalog of known agents and how to spawn them.
//
// NOTE on dead_code: the mutation surface (new_empty/insert/remove/len)
// is exposed for upcoming custom-agent CRUD commands; v1 only ships
// `acp_list_agents`. The methods are exercised by tests in this module.
#![allow(dead_code)]

//
// The registry is keyed by `AgentId` and each entry carries the program
// to spawn plus its credential source. Persistence is deferred: v1 ships
// with a builtin Claude Code entry baked in via `default()` and lets the
// caller add ephemeral entries at runtime. A future revision will pull
// custom agents from the workspace settings store.

use std::collections::BTreeMap;

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
}
