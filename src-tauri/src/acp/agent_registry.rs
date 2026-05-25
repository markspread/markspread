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
        // Builtin: Claude Code via the Zed-maintained ACP adapter shim.
        // Users with the official `claude` binary on PATH can override
        // `command` at runtime; we choose the npx form by default since
        // the spec acknowledges it as the canonical install path.
        let claude = AgentEntry {
            id: AgentId("claude".into()),
            name: "Claude Code".into(),
            command: vec!["npx".into(), "@zed-industries/claude-agent-acp".into()],
            auth: AuthMode::ClaudeSubscription,
        };
        entries.insert(claude.id.0.clone(), claude);
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
        r.insert(AgentEntry {
            id: AgentId("codex".into()),
            name: "Codex CLI".into(),
            command: vec!["npx".into(), "codex-acp".into()],
            auth: AuthMode::ApiKey {
                keychain_service: "com.markspread.app".into(),
                account: "ai-keys/byo/openai-default".into(),
                env_var: "OPENAI_API_KEY".into(),
            },
        });
        let json = serde_json::to_string(&r).unwrap();
        let back: AgentRegistry = serde_json::from_str(&json).unwrap();
        assert_eq!(back.len(), 2);
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
        });
        r.insert(AgentEntry {
            id: AgentId("alpha".into()),
            name: "Alpha".into(),
            command: vec!["a".into()],
            auth: AuthMode::None,
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
        assert!(r.is_empty());
        assert!(r.get(&id).is_none());
    }
}
