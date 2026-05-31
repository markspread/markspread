// S-AI-ACP-001 §6: spawn-time credential router.
//
// `AuthMode` is a small enum describing where to pull credentials from
// before spawning the agent child. `resolve_env` returns a vector of
// `(env_key, env_value)` pairs to inject into `Command::env`. The
// returned `String` values carry plaintext secrets — callers must drop
// them as soon as the child has been spawned (the OS copies the env
// block into the child's address space at fork/CreateProcess time).
//
// Two seams enable testing without touching the OS keychain:
//   * `set_subscription_resolver_for_test` — overrides the closure that
//     normally calls `ai_auth::ai_keys_get_subscription`.
//   * `set_api_key_resolver_for_test` — overrides the closure that
//     normally calls `keyring::Entry::get_password`.
// Both seams are gated behind `#[cfg(test)]` (`test` only) and a public
// `_for_test` suffix to make their intent obvious.

use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(tag = "kind", rename_all = "snake_case")]
pub enum AuthMode {
    /// Claude Code: read the active subscription credential via `ai_auth`
    /// and inject as `ANTHROPIC_API_KEY`.
    ClaudeSubscription,
    /// Generic BYO key: read a keychain entry under a configured service
    /// + account and inject under the named env var.
    #[serde(rename_all = "camelCase")]
    ApiKey {
        keychain_service: String,
        account: String,
        env_var: String,
    },
    /// No spawn-time credential injection (agent handles its own auth,
    /// e.g. `gh auth login` for Copilot CLI).
    None,
}

#[derive(Debug, thiserror::Error)]
pub enum AuthError {
    #[error("auth: subscription credential not available")]
    NoSubscription,
    #[error("auth: keychain read failed: {0}")]
    Keychain(String),
}

pub type AuthResult<T> = Result<T, AuthError>;

/// Resolves the configured `AuthMode` into env vars suitable for
/// `Command::env`. Returned values are plaintext — drop immediately after
/// spawn.
///
/// `ClaudeSubscription` 의 경우 Markspread keychain 에 구독 토큰이 없어도
/// 에러로 spawn 을 막지 않는다 (ADR-0004). ACP 어댑터 (Claude Agent SDK)
/// 가 자체적으로 `~/.claude/` 의 사용자 토큰 또는 OAuth 플로우로 인증
/// 처리하므로, 단순히 ANTHROPIC_API_KEY 를 inject 하지 않고 spawn 만 진행
/// 한다. ApiKey 모드는 키 부재 시 진짜 에러 (그쪽은 어댑터가 fallback
/// 없음).
pub async fn resolve_env(mode: &AuthMode) -> AuthResult<Vec<(String, String)>> {
    match mode {
        AuthMode::None => Ok(vec![]),
        AuthMode::ClaudeSubscription => match resolve_subscription_token().await {
            Ok(token) => Ok(vec![("ANTHROPIC_API_KEY".to_string(), token)]),
            Err(AuthError::NoSubscription) => {
                // 어댑터의 자체 인증 (~/.claude/ 토큰 또는 OAuth) 에 맡김.
                Ok(vec![])
            }
            Err(other) => Err(other),
        },
        AuthMode::ApiKey {
            keychain_service,
            account,
            env_var,
        } => {
            let secret = resolve_api_key(keychain_service, account)?;
            Ok(vec![(env_var.clone(), secret)])
        }
    }
}

#[cfg(not(test))]
async fn resolve_subscription_token() -> AuthResult<String> {
    // The existing IPC command returns metadata (placeholders), not the
    // plaintext access token. The plaintext lives only in the keychain
    // entry `ai-keys/anthropic/subscription` — read it directly here. We
    // require a credential row to exist (so user has authenticated) and
    // then pull the entry password.
    let meta = crate::ai_auth::ai_keys_get_subscription()
        .await
        .map_err(|e| AuthError::Keychain(format!("subscription meta: {e}")))?;
    if meta.is_none() {
        return Err(AuthError::NoSubscription);
    }
    let entry = keyring::Entry::new(
        crate::ops::KEYCHAIN_SERVICE,
        "ai-keys/anthropic/subscription",
    )
    .map_err(|e| AuthError::Keychain(format!("entry open: {e}")))?;
    entry
        .get_password()
        .map_err(|e| AuthError::Keychain(format!("entry read: {e}")))
}

#[cfg(not(test))]
fn resolve_api_key(service: &str, account: &str) -> AuthResult<String> {
    let entry = keyring::Entry::new(service, account)
        .map_err(|e| AuthError::Keychain(format!("entry open: {e}")))?;
    entry
        .get_password()
        .map_err(|e| AuthError::Keychain(format!("entry read: {e}")))
}

// ─── Test seams ─────────────────────────────────────────────────────────

#[cfg(test)]
use std::sync::Mutex;

#[cfg(test)]
static SUBSCRIPTION_RESOLVER: Mutex<Option<AuthResult<String>>> = Mutex::new(None);

#[cfg(test)]
static API_KEY_RESOLVER: Mutex<Option<AuthResult<String>>> = Mutex::new(None);

#[cfg(test)]
pub fn set_subscription_resolver_for_test(result: AuthResult<String>) {
    let cloned = match &result {
        Ok(s) => Ok(s.clone()),
        Err(e) => Err(clone_err(e)),
    };
    *SUBSCRIPTION_RESOLVER.lock().unwrap() = Some(cloned);
}

#[cfg(test)]
pub fn set_api_key_resolver_for_test(result: AuthResult<String>) {
    let cloned = match &result {
        Ok(s) => Ok(s.clone()),
        Err(e) => Err(clone_err(e)),
    };
    *API_KEY_RESOLVER.lock().unwrap() = Some(cloned);
}

#[cfg(test)]
fn clone_err(e: &AuthError) -> AuthError {
    match e {
        AuthError::NoSubscription => AuthError::NoSubscription,
        AuthError::Keychain(s) => AuthError::Keychain(s.clone()),
    }
}

#[cfg(test)]
async fn resolve_subscription_token() -> AuthResult<String> {
    let mut slot = SUBSCRIPTION_RESOLVER.lock().unwrap();
    slot.take().unwrap_or(Err(AuthError::NoSubscription))
}

#[cfg(test)]
fn resolve_api_key(_service: &str, _account: &str) -> AuthResult<String> {
    let mut slot = API_KEY_RESOLVER.lock().unwrap();
    slot.take()
        .unwrap_or(Err(AuthError::Keychain("no test resolver set".into())))
}

#[cfg(test)]
mod tests {
    use super::*;
    use serial_test::serial;

    #[tokio::test]
    #[serial]
    async fn none_mode_yields_no_env() {
        let env = resolve_env(&AuthMode::None).await.unwrap();
        assert!(env.is_empty());
    }

    #[tokio::test]
    #[serial]
    async fn claude_subscription_injects_anthropic_api_key() {
        set_subscription_resolver_for_test(Ok("test-access-token".to_string()));
        let env = resolve_env(&AuthMode::ClaudeSubscription).await.unwrap();
        assert_eq!(env.len(), 1);
        assert_eq!(env[0].0, "ANTHROPIC_API_KEY");
        assert_eq!(env[0].1, "test-access-token");
    }

    #[tokio::test]
    #[serial]
    async fn claude_subscription_no_credential_yields_empty_env_not_error() {
        // ADR-0004: Markspread keychain 에 토큰이 없어도 spawn 을 막지 않음.
        // ACP 어댑터가 자체 ~/.claude/ 또는 OAuth 로 처리.
        set_subscription_resolver_for_test(Err(AuthError::NoSubscription));
        let env = resolve_env(&AuthMode::ClaudeSubscription).await.unwrap();
        assert!(env.is_empty(), "expected empty env to delegate to adapter");
    }

    #[tokio::test]
    #[serial]
    async fn claude_subscription_propagates_non_missing_keychain_error() {
        set_subscription_resolver_for_test(Err(AuthError::Keychain("perm denied".into())));
        let err = resolve_env(&AuthMode::ClaudeSubscription)
            .await
            .unwrap_err();
        match err {
            AuthError::Keychain(s) => assert!(s.contains("perm denied")),
            other => panic!("expected Keychain, got {other:?}"),
        }
    }

    #[tokio::test]
    #[serial]
    async fn api_key_mode_injects_named_env_var() {
        set_api_key_resolver_for_test(Ok("sk-test".to_string()));
        let env = resolve_env(&AuthMode::ApiKey {
            keychain_service: "com.markspread.app".into(),
            account: "ai-keys/byo/openai-default".into(),
            env_var: "OPENAI_API_KEY".into(),
        })
        .await
        .unwrap();
        assert_eq!(env.len(), 1);
        assert_eq!(env[0].0, "OPENAI_API_KEY");
        assert_eq!(env[0].1, "sk-test");
    }

    #[tokio::test]
    #[serial]
    async fn api_key_mode_propagates_keychain_error() {
        set_api_key_resolver_for_test(Err(AuthError::Keychain("no entry".into())));
        let err = resolve_env(&AuthMode::ApiKey {
            keychain_service: "x".into(),
            account: "y".into(),
            env_var: "Z".into(),
        })
        .await
        .unwrap_err();
        match err {
            AuthError::Keychain(s) => assert!(s.contains("no entry")),
            other => panic!("expected Keychain, got {other:?}"),
        }
    }

    #[test]
    fn auth_mode_serialisation_uses_kind_tag() {
        let m = AuthMode::ClaudeSubscription;
        let v = serde_json::to_value(&m).unwrap();
        assert_eq!(v["kind"], "claude_subscription");

        let m = AuthMode::ApiKey {
            keychain_service: "svc".into(),
            account: "acct".into(),
            env_var: "ENV".into(),
        };
        let v = serde_json::to_value(&m).unwrap();
        assert_eq!(v["kind"], "api_key");
        assert_eq!(v["envVar"], "ENV");

        let back: AuthMode = serde_json::from_value(v).unwrap();
        assert_eq!(back, m);

        let m = AuthMode::None;
        let v = serde_json::to_value(&m).unwrap();
        assert_eq!(v["kind"], "none");
    }
}
