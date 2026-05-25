// S-AI-AUTH-003 (ADR-0004): Anthropic 구독 인증 — OAuth 2.0 Authorization
// Code + PKCE (RFC 7636) over loopback redirect (RFC 8252 §7.3).
//
// 흐름 요약:
//   1. begin: PKCE verifier/challenge 생성 → 127.0.0.1:<random> 에 HTTP
//      리스너 기동 → 사용자 브라우저로 보낼 인가 URL 반환.
//   2. 사용자가 브라우저에서 동의를 마치면 IdP 가
//      http://127.0.0.1:<port>/callback?code=…&state=… 으로 리다이렉트.
//   3. 리스너가 state 검증(CSRF) 후 토큰 endpoint 와 code 교환.
//   4. await_completion: access/refresh/meta 3 항목을 키체인에 저장하고
//      메타데이터만 IPC 로 반환. 평문 토큰은 IPC 경계를 절대 넘지 않는다.
//
// 보안:
//   • 모든 토큰은 keyring 서비스 `com.markspread.app` 의 세 항목
//     (`ai-keys/anthropic/subscription` = access,
//      `…/refresh` = refresh,
//      `…/meta`    = JSON 메타: 만료 시각, account label, alias) 으로 저장.
//   • PKCE verifier 는 메모리에만 보관, 세션 종료 즉시 폐기.
//   • state 는 32B 무작위 — CSRF 차단용.
//   • client_id 가 비어 있으면 fail-closed (begin 이 곧장 EINVAL).
//
// 테스트:
//   • PKCE challenge 는 RFC 7636 §B.1 시험 벡터로 검증.
//   • 토큰 교환은 wiremock 으로 IdP 를 모사.
//   • 키체인 round-trip 은 OS keyring 의존이라 통합 테스트에서만 다룬다.

use std::collections::HashMap;
use std::sync::{Arc, Mutex, OnceLock};
use std::time::Duration;

use base64::engine::general_purpose::URL_SAFE_NO_PAD;
use base64::Engine;
use rand::RngCore;
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tokio::net::TcpListener;
use tokio::sync::Notify;

use crate::error::AppError;
use crate::ops::KEYCHAIN_SERVICE;

const KEYCHAIN_ITEM_ACCESS: &str = "ai-keys/anthropic/subscription";
const KEYCHAIN_ITEM_REFRESH: &str = "ai-keys/anthropic/subscription/refresh";
const KEYCHAIN_ITEM_META: &str = "ai-keys/anthropic/subscription/meta";
const SESSION_TIMEOUT_SECS: u64 = 300;
const DEFAULT_SCOPE: &str = "user:inference offline_access";
const DEFAULT_ALIAS: &str = "anthropic-subscription";

#[derive(Debug, Clone)]
struct OAuthConfig {
    authorize_url: String,
    token_url: String,
    client_id: String,
    scope: String,
}

impl OAuthConfig {
    fn from_env() -> Self {
        Self {
            authorize_url: std::env::var("MARKSPREAD_OAUTH_AUTHORIZE_URL").unwrap_or_default(),
            token_url: std::env::var("MARKSPREAD_OAUTH_TOKEN_URL").unwrap_or_default(),
            client_id: std::env::var("MARKSPREAD_OAUTH_CLIENT_ID").unwrap_or_default(),
            scope: std::env::var("MARKSPREAD_OAUTH_SCOPE")
                .unwrap_or_else(|_| DEFAULT_SCOPE.to_string()),
        }
    }

    fn validate(&self) -> Result<(), AppError> {
        if self.client_id.is_empty() || self.authorize_url.is_empty() || self.token_url.is_empty() {
            return Err(AppError::Invalid(
                "구독 인증이 빌드 시점에 구성되지 않았습니다 \
                 (MARKSPREAD_OAUTH_CLIENT_ID/AUTHORIZE_URL/TOKEN_URL 누락)"
                    .into(),
            ));
        }
        Ok(())
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AuthBeginResponse {
    pub verification_url: String,
    pub user_code: Option<String>,
    pub session_id: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AuthCompleteResponse {
    pub provider_id: String,
    pub alias: String,
    pub expires_at: i64,
    pub account_label: Option<String>,
}

/// 프론트 `auth-refresh-boot.ts` 가 직접 받는 자격 증명 형태.
/// `credentials.ts` 의 SubscriptionCredentialSchema 와 1:1 매칭된다.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SubscriptionCredential {
    pub kind: &'static str,
    pub provider_id: &'static str,
    pub alias: String,
    pub encrypted_access_token: String,
    pub encrypted_refresh_token: String,
    pub expires_at: i64,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub account_label: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
struct StoredMeta {
    alias: String,
    expires_at: i64,
    account_label: Option<String>,
}

#[derive(Debug, Deserialize)]
struct TokenResponse {
    access_token: String,
    #[serde(default)]
    refresh_token: Option<String>,
    #[serde(default)]
    expires_in: Option<i64>,
    #[serde(default)]
    account_label: Option<String>,
}

struct SessionInner {
    state: String,
    code_verifier: String,
    redirect_uri: String,
    result: Mutex<Option<Result<AuthCompleteResponse, AppError>>>,
    done: Notify,
    shutdown: Notify,
}

fn sessions() -> &'static Mutex<HashMap<String, Arc<SessionInner>>> {
    static SESSIONS: OnceLock<Mutex<HashMap<String, Arc<SessionInner>>>> = OnceLock::new();
    SESSIONS.get_or_init(|| Mutex::new(HashMap::new()))
}

fn random_b64url(bytes: usize) -> String {
    let mut buf = vec![0u8; bytes];
    rand::thread_rng().fill_bytes(&mut buf);
    URL_SAFE_NO_PAD.encode(&buf)
}

fn pkce_challenge(verifier: &str) -> String {
    let digest = Sha256::digest(verifier.as_bytes());
    URL_SAFE_NO_PAD.encode(digest)
}

fn build_authorize_url(
    cfg: &OAuthConfig,
    redirect_uri: &str,
    state: &str,
    challenge: &str,
) -> String {
    let mut params = vec![
        ("response_type", "code"),
        ("client_id", cfg.client_id.as_str()),
        ("redirect_uri", redirect_uri),
        ("state", state),
        ("code_challenge", challenge),
        ("code_challenge_method", "S256"),
    ];
    params.push(("scope", cfg.scope.as_str()));
    let qs = params
        .iter()
        .map(|(k, v)| format!("{}={}", k, urlencoding::encode(v)))
        .collect::<Vec<_>>()
        .join("&");
    let sep = if cfg.authorize_url.contains('?') {
        "&"
    } else {
        "?"
    };
    format!("{}{}{}", cfg.authorize_url, sep, qs)
}

#[derive(Debug)]
struct CallbackParams {
    code: Option<String>,
    state: Option<String>,
    error: Option<String>,
}

fn parse_callback_query(target: &str) -> CallbackParams {
    let mut out = CallbackParams {
        code: None,
        state: None,
        error: None,
    };
    let qs = match target.split_once('?') {
        Some((_, q)) => q,
        None => return out,
    };
    for pair in qs.split('&') {
        let Some((k, v)) = pair.split_once('=') else {
            continue;
        };
        let v = urlencoding::decode(v)
            .map(|c| c.into_owned())
            .unwrap_or_else(|_| v.to_string());
        match k {
            "code" => out.code = Some(v),
            "state" => out.state = Some(v),
            "error" => out.error = Some(v),
            _ => {}
        }
    }
    out
}

fn html_response(status: &str, body: &str) -> Vec<u8> {
    let payload = format!(
        "<!doctype html><html><head><meta charset=\"utf-8\"><title>Markspread</title>\
         <style>body{{font-family:-apple-system,system-ui,sans-serif;padding:48px;text-align:center}}\
         h1{{font-size:20px;margin-bottom:8px}}p{{color:#555}}</style></head>\
         <body>{body}<p>이 창은 닫아도 됩니다.</p></body></html>"
    );
    format!(
        "HTTP/1.1 {status}\r\nContent-Type: text/html; charset=utf-8\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{}",
        payload.len(),
        payload
    )
    .into_bytes()
}

async fn read_request_line(stream: &mut tokio::net::TcpStream) -> std::io::Result<String> {
    let mut buf = [0u8; 4096];
    let n = stream.read(&mut buf).await?;
    let text = String::from_utf8_lossy(&buf[..n]).to_string();
    let line = text.lines().next().unwrap_or("").to_string();
    Ok(line)
}

async fn run_loopback_server(listener: TcpListener, session: Arc<SessionInner>, cfg: OAuthConfig) {
    loop {
        tokio::select! {
            _ = session.shutdown.notified() => {
                return;
            }
            accepted = listener.accept() => {
                let Ok((mut stream, _)) = accepted else { continue };
                let line = match read_request_line(&mut stream).await {
                    Ok(l) => l,
                    Err(_) => continue,
                };
                let target = line.split_whitespace().nth(1).unwrap_or("");
                if !target.starts_with("/callback") {
                    let _ = stream.write_all(&html_response("404 Not Found", "<h1>Not Found</h1>")).await;
                    let _ = stream.shutdown().await;
                    continue;
                }
                let params = parse_callback_query(target);
                let outcome = handle_callback(&session, &cfg, params).await;
                let body = match &outcome {
                    Ok(_) => html_response("200 OK", "<h1>인증이 완료되었습니다</h1>"),
                    Err(e) => html_response("400 Bad Request", &format!("<h1>인증 실패</h1><p>{}</p>", e)),
                };
                let _ = stream.write_all(&body).await;
                let _ = stream.shutdown().await;
                {
                    let mut slot = session.result.lock().unwrap();
                    *slot = Some(outcome);
                }
                session.done.notify_waiters();
                return;
            }
        }
    }
}

async fn handle_callback(
    session: &SessionInner,
    cfg: &OAuthConfig,
    params: CallbackParams,
) -> Result<AuthCompleteResponse, AppError> {
    if let Some(err) = params.error {
        return Err(AppError::Invalid(format!("OAuth 제공자 거부: {err}")));
    }
    let code = params
        .code
        .ok_or_else(|| AppError::Invalid("콜백에 code 가 없습니다".into()))?;
    let state = params
        .state
        .ok_or_else(|| AppError::Invalid("콜백에 state 가 없습니다".into()))?;
    if state != session.state {
        return Err(AppError::Invalid(
            "state 불일치 — CSRF 시도일 수 있습니다".into(),
        ));
    }
    let token =
        exchange_authorization_code(cfg, &code, &session.code_verifier, &session.redirect_uri)
            .await?;
    let stored = persist_tokens(&token, None)?;
    Ok(AuthCompleteResponse {
        provider_id: "anthropic".into(),
        alias: stored.alias,
        expires_at: stored.expires_at,
        account_label: stored.account_label,
    })
}

async fn exchange_authorization_code(
    cfg: &OAuthConfig,
    code: &str,
    code_verifier: &str,
    redirect_uri: &str,
) -> Result<TokenResponse, AppError> {
    let client = reqwest::Client::builder()
        .timeout(Duration::from_secs(30))
        .build()
        .map_err(|e| AppError::Invalid(format!("HTTP 클라이언트 초기화 실패: {e}")))?;
    let form = [
        ("grant_type", "authorization_code"),
        ("code", code),
        ("redirect_uri", redirect_uri),
        ("client_id", cfg.client_id.as_str()),
        ("code_verifier", code_verifier),
    ];
    let resp = client
        .post(&cfg.token_url)
        .form(&form)
        .send()
        .await
        .map_err(|e| AppError::Invalid(format!("토큰 교환 요청 실패: {e}")))?;
    let status = resp.status();
    let body = resp.text().await.unwrap_or_default();
    if !status.is_success() {
        return Err(AppError::Invalid(format!(
            "토큰 교환 실패 ({status}): {body}"
        )));
    }
    serde_json::from_str::<TokenResponse>(&body)
        .map_err(|e| AppError::Invalid(format!("토큰 응답 파싱 실패: {e}")))
}

async fn exchange_refresh_token(
    cfg: &OAuthConfig,
    refresh_token: &str,
) -> Result<TokenResponse, AppError> {
    let client = reqwest::Client::builder()
        .timeout(Duration::from_secs(30))
        .build()
        .map_err(|e| AppError::Invalid(format!("HTTP 클라이언트 초기화 실패: {e}")))?;
    let form = [
        ("grant_type", "refresh_token"),
        ("refresh_token", refresh_token),
        ("client_id", cfg.client_id.as_str()),
    ];
    let resp = client
        .post(&cfg.token_url)
        .form(&form)
        .send()
        .await
        .map_err(|e| AppError::Invalid(format!("토큰 갱신 요청 실패: {e}")))?;
    let status = resp.status();
    let body = resp.text().await.unwrap_or_default();
    if !status.is_success() {
        return Err(AppError::Invalid(format!(
            "토큰 갱신 실패 ({status}): {body}"
        )));
    }
    serde_json::from_str::<TokenResponse>(&body)
        .map_err(|e| AppError::Invalid(format!("토큰 응답 파싱 실패: {e}")))
}

fn persist_tokens(
    token: &TokenResponse,
    prior_refresh: Option<&str>,
) -> Result<StoredMeta, AppError> {
    let access_entry = keyring::Entry::new(KEYCHAIN_SERVICE, KEYCHAIN_ITEM_ACCESS)
        .map_err(|e| AppError::Invalid(format!("키체인 엔트리 생성 실패: {e}")))?;
    access_entry
        .set_password(&token.access_token)
        .map_err(|e| AppError::Invalid(format!("access token 저장 실패: {e}")))?;

    // 일부 IdP 는 rotation 시 refresh_token 을 생략한다 — 그 경우 기존 값을 유지.
    let refresh_value = token
        .refresh_token
        .as_deref()
        .or(prior_refresh)
        .unwrap_or("");
    if !refresh_value.is_empty() {
        let refresh_entry = keyring::Entry::new(KEYCHAIN_SERVICE, KEYCHAIN_ITEM_REFRESH)
            .map_err(|e| AppError::Invalid(format!("키체인 엔트리 생성 실패: {e}")))?;
        refresh_entry
            .set_password(refresh_value)
            .map_err(|e| AppError::Invalid(format!("refresh token 저장 실패: {e}")))?;
    }

    let now_ms = chrono::Utc::now().timestamp_millis();
    let expires_at = now_ms + token.expires_in.unwrap_or(3600).saturating_mul(1000);
    let meta = StoredMeta {
        alias: DEFAULT_ALIAS.into(),
        expires_at,
        account_label: token.account_label.clone(),
    };
    let meta_json = serde_json::to_string(&meta)
        .map_err(|e| AppError::Invalid(format!("메타 직렬화 실패: {e}")))?;
    let meta_entry = keyring::Entry::new(KEYCHAIN_SERVICE, KEYCHAIN_ITEM_META)
        .map_err(|e| AppError::Invalid(format!("키체인 엔트리 생성 실패: {e}")))?;
    meta_entry
        .set_password(&meta_json)
        .map_err(|e| AppError::Invalid(format!("메타 저장 실패: {e}")))?;
    Ok(meta)
}

fn meta_to_credential(meta: StoredMeta) -> SubscriptionCredential {
    SubscriptionCredential {
        kind: "subscription",
        provider_id: "anthropic",
        alias: meta.alias,
        encrypted_access_token: format!("keychain://{KEYCHAIN_ITEM_ACCESS}#access"),
        encrypted_refresh_token: format!("keychain://{KEYCHAIN_ITEM_ACCESS}#refresh"),
        expires_at: meta.expires_at,
        account_label: meta.account_label,
    }
}

fn read_stored_meta() -> Option<StoredMeta> {
    let entry = keyring::Entry::new(KEYCHAIN_SERVICE, KEYCHAIN_ITEM_META).ok()?;
    let raw = entry.get_password().ok()?;
    serde_json::from_str(&raw).ok()
}

fn read_stored_refresh() -> Option<String> {
    let entry = keyring::Entry::new(KEYCHAIN_SERVICE, KEYCHAIN_ITEM_REFRESH).ok()?;
    entry.get_password().ok()
}

#[tauri::command]
pub async fn ai_auth_begin_subscription(
    provider_id: String,
) -> Result<AuthBeginResponse, AppError> {
    if provider_id != "anthropic" {
        return Err(AppError::Invalid(format!(
            "subscription auth not supported for provider '{provider_id}'"
        )));
    }
    let cfg = OAuthConfig::from_env();
    cfg.validate()?;

    let listener = TcpListener::bind("127.0.0.1:0")
        .await
        .map_err(|e| AppError::Invalid(format!("로컬 리스너 바인드 실패: {e}")))?;
    let port = listener
        .local_addr()
        .map_err(|e| AppError::Invalid(format!("리스너 주소 조회 실패: {e}")))?
        .port();
    let redirect_uri = format!("http://127.0.0.1:{port}/callback");

    let session_id = random_b64url(24);
    let state = random_b64url(32);
    let verifier = random_b64url(32);
    let challenge = pkce_challenge(&verifier);
    let verification_url = build_authorize_url(&cfg, &redirect_uri, &state, &challenge);

    let session = Arc::new(SessionInner {
        state,
        code_verifier: verifier,
        redirect_uri,
        result: Mutex::new(None),
        done: Notify::new(),
        shutdown: Notify::new(),
    });
    {
        let mut map = sessions().lock().unwrap();
        map.insert(session_id.clone(), session.clone());
    }
    let session_for_task = session.clone();
    let cfg_for_task = cfg.clone();
    tokio::spawn(run_loopback_server(
        listener,
        session_for_task,
        cfg_for_task,
    ));

    Ok(AuthBeginResponse {
        verification_url,
        user_code: None,
        session_id,
    })
}

#[tauri::command]
pub async fn ai_auth_await_completion(
    session_id: String,
) -> Result<AuthCompleteResponse, AppError> {
    let session = {
        let map = sessions().lock().unwrap();
        map.get(&session_id).cloned()
    };
    let session = session.ok_or_else(|| AppError::Invalid("알 수 없는 session_id".into()))?;

    let outcome = tokio::time::timeout(Duration::from_secs(SESSION_TIMEOUT_SECS), async {
        loop {
            {
                let slot = session.result.lock().unwrap();
                if slot.is_some() {
                    break;
                }
            }
            session.done.notified().await;
        }
    })
    .await;

    let result = {
        let mut slot = session.result.lock().unwrap();
        slot.take()
    };
    {
        let mut map = sessions().lock().unwrap();
        map.remove(&session_id);
    }
    session.shutdown.notify_waiters();

    match (outcome, result) {
        (Ok(()), Some(r)) => r,
        _ => Err(AppError::Invalid(
            "인증 세션이 5분 안에 완료되지 않았습니다".into(),
        )),
    }
}

#[tauri::command]
pub async fn ai_auth_cancel(session_id: String) -> Result<(), AppError> {
    let session = {
        let mut map = sessions().lock().unwrap();
        map.remove(&session_id)
    };
    if let Some(s) = session {
        {
            let mut slot = s.result.lock().unwrap();
            if slot.is_none() {
                *slot = Some(Err(AppError::Invalid("세션이 취소되었습니다".into())));
            }
        }
        s.shutdown.notify_waiters();
        s.done.notify_waiters();
    }
    Ok(())
}

#[tauri::command]
pub async fn ai_keys_get_subscription() -> Result<Option<SubscriptionCredential>, AppError> {
    Ok(read_stored_meta().map(meta_to_credential))
}

#[tauri::command]
pub async fn ai_auth_refresh_subscription(
    alias: String,
) -> Result<SubscriptionCredential, AppError> {
    let _ = alias;
    let cfg = OAuthConfig::from_env();
    cfg.validate()?;
    let prior_refresh = read_stored_refresh()
        .ok_or_else(|| AppError::Invalid("refresh token 이 키체인에 없습니다".into()))?;
    let token = exchange_refresh_token(&cfg, &prior_refresh).await?;
    let meta = persist_tokens(&token, Some(&prior_refresh))?;
    Ok(meta_to_credential(meta))
}

#[cfg(test)]
mod tests {
    use super::*;

    // RFC 7636 §B.1 시험 벡터: verifier "dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk"
    // → challenge "E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM".
    #[test]
    fn pkce_challenge_matches_rfc7636_appendix_b1_vector() {
        let verifier = "dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk";
        let challenge = pkce_challenge(verifier);
        assert_eq!(challenge, "E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM");
    }

    #[test]
    fn random_b64url_produces_padding_free_alphabet() {
        let s = random_b64url(32);
        assert!(!s.contains('='));
        assert!(s
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || c == '-' || c == '_'));
        assert!(s.len() >= 40);
    }

    #[test]
    fn random_b64url_is_unique_across_calls() {
        let a = random_b64url(32);
        let b = random_b64url(32);
        assert_ne!(a, b, "two consecutive draws must not collide");
    }

    #[test]
    fn config_validate_rejects_empty_client_id() {
        let cfg = OAuthConfig {
            authorize_url: "https://example.com/authorize".into(),
            token_url: "https://example.com/token".into(),
            client_id: "".into(),
            scope: DEFAULT_SCOPE.into(),
        };
        assert!(cfg.validate().is_err());
    }

    #[test]
    fn config_validate_accepts_complete_config() {
        let cfg = OAuthConfig {
            authorize_url: "https://example.com/authorize".into(),
            token_url: "https://example.com/token".into(),
            client_id: "client".into(),
            scope: DEFAULT_SCOPE.into(),
        };
        assert!(cfg.validate().is_ok());
    }

    #[test]
    fn build_authorize_url_encodes_required_params() {
        let cfg = OAuthConfig {
            authorize_url: "https://example.com/authorize".into(),
            token_url: "https://example.com/token".into(),
            client_id: "client id".into(),
            scope: "user:inference offline_access".into(),
        };
        let url = build_authorize_url(
            &cfg,
            "http://127.0.0.1:12345/callback",
            "STATE!",
            "CHALLENGE",
        );
        assert!(url.starts_with("https://example.com/authorize?"));
        assert!(url.contains("response_type=code"));
        assert!(url.contains("client_id=client%20id"));
        assert!(url.contains("redirect_uri=http%3A%2F%2F127.0.0.1%3A12345%2Fcallback"));
        assert!(url.contains("state=STATE%21"));
        assert!(url.contains("code_challenge=CHALLENGE"));
        assert!(url.contains("code_challenge_method=S256"));
        assert!(url.contains("scope=user%3Ainference%20offline_access"));
    }

    #[test]
    fn build_authorize_url_uses_amp_when_base_already_has_query() {
        let cfg = OAuthConfig {
            authorize_url: "https://example.com/authorize?org=acme".into(),
            token_url: "https://example.com/token".into(),
            client_id: "c".into(),
            scope: DEFAULT_SCOPE.into(),
        };
        let url = build_authorize_url(&cfg, "http://127.0.0.1:1/c", "s", "ch");
        assert!(url.starts_with("https://example.com/authorize?org=acme&"));
    }

    #[test]
    fn parse_callback_query_extracts_code_state_and_error() {
        let p = parse_callback_query("/callback?code=abc&state=xyz");
        assert_eq!(p.code.as_deref(), Some("abc"));
        assert_eq!(p.state.as_deref(), Some("xyz"));
        assert!(p.error.is_none());

        let p = parse_callback_query("/callback?error=access_denied&state=s");
        assert_eq!(p.error.as_deref(), Some("access_denied"));

        let p = parse_callback_query("/callback?code=hello%20world");
        assert_eq!(p.code.as_deref(), Some("hello world"));
    }

    #[test]
    fn parse_callback_query_handles_no_query_string() {
        let p = parse_callback_query("/callback");
        assert!(p.code.is_none() && p.state.is_none() && p.error.is_none());
    }

    #[test]
    fn meta_to_credential_uses_keychain_placeholders() {
        let meta = StoredMeta {
            alias: "anthropic-subscription".into(),
            expires_at: 1_700_000_000_000,
            account_label: Some("user@example.com".into()),
        };
        let cred = meta_to_credential(meta);
        assert_eq!(cred.kind, "subscription");
        assert_eq!(cred.provider_id, "anthropic");
        assert!(cred.encrypted_access_token.starts_with("keychain://"));
        assert!(cred.encrypted_refresh_token.starts_with("keychain://"));
        assert_eq!(cred.expires_at, 1_700_000_000_000);
        assert_eq!(cred.account_label.as_deref(), Some("user@example.com"));
    }

    #[test]
    fn subscription_credential_serializes_in_camel_case() {
        let cred = SubscriptionCredential {
            kind: "subscription",
            provider_id: "anthropic",
            alias: "a".into(),
            encrypted_access_token: "k1".into(),
            encrypted_refresh_token: "k2".into(),
            expires_at: 42,
            account_label: None,
        };
        let json = serde_json::to_string(&cred).unwrap();
        assert!(json.contains("\"providerId\":\"anthropic\""));
        assert!(json.contains("\"encryptedAccessToken\":\"k1\""));
        assert!(json.contains("\"encryptedRefreshToken\":\"k2\""));
        assert!(json.contains("\"expiresAt\":42"));
        assert!(!json.contains("accountLabel"));
    }

    #[tokio::test]
    async fn exchange_authorization_code_posts_pkce_form_and_parses_response() {
        use wiremock::matchers::{body_string_contains, method, path};
        use wiremock::{Mock, MockServer, ResponseTemplate};

        let server = MockServer::start().await;
        Mock::given(method("POST"))
            .and(path("/token"))
            .and(body_string_contains("grant_type=authorization_code"))
            .and(body_string_contains("code_verifier=VERIFIER"))
            .and(body_string_contains("code=AUTHCODE"))
            .respond_with(
                ResponseTemplate::new(200).set_body_string(
                    r#"{"access_token":"AT","refresh_token":"RT","expires_in":3600}"#,
                ),
            )
            .mount(&server)
            .await;

        let cfg = OAuthConfig {
            authorize_url: format!("{}/authorize", server.uri()),
            token_url: format!("{}/token", server.uri()),
            client_id: "client".into(),
            scope: DEFAULT_SCOPE.into(),
        };
        let token = exchange_authorization_code(
            &cfg,
            "AUTHCODE",
            "VERIFIER",
            "http://127.0.0.1:1/callback",
        )
        .await
        .expect("token exchange should succeed");
        assert_eq!(token.access_token, "AT");
        assert_eq!(token.refresh_token.as_deref(), Some("RT"));
        assert_eq!(token.expires_in, Some(3600));
    }

    #[tokio::test]
    async fn exchange_authorization_code_propagates_idp_error_body() {
        use wiremock::matchers::{method, path};
        use wiremock::{Mock, MockServer, ResponseTemplate};

        let server = MockServer::start().await;
        Mock::given(method("POST"))
            .and(path("/token"))
            .respond_with(
                ResponseTemplate::new(400).set_body_string(
                    r#"{"error":"invalid_grant","error_description":"code expired"}"#,
                ),
            )
            .mount(&server)
            .await;
        let cfg = OAuthConfig {
            authorize_url: format!("{}/authorize", server.uri()),
            token_url: format!("{}/token", server.uri()),
            client_id: "c".into(),
            scope: DEFAULT_SCOPE.into(),
        };
        let err = exchange_authorization_code(&cfg, "x", "v", "http://127.0.0.1:1/c")
            .await
            .expect_err("should propagate IdP failure");
        let msg = format!("{err}");
        assert!(msg.contains("400"));
        assert!(msg.contains("invalid_grant"));
    }

    #[tokio::test]
    async fn exchange_refresh_token_posts_refresh_grant() {
        use wiremock::matchers::{body_string_contains, method, path};
        use wiremock::{Mock, MockServer, ResponseTemplate};

        let server = MockServer::start().await;
        Mock::given(method("POST"))
            .and(path("/token"))
            .and(body_string_contains("grant_type=refresh_token"))
            .and(body_string_contains("refresh_token=PRIORREFRESH"))
            .respond_with(
                ResponseTemplate::new(200)
                    .set_body_string(r#"{"access_token":"NEWACCESS","expires_in":1800}"#),
            )
            .mount(&server)
            .await;
        let cfg = OAuthConfig {
            authorize_url: format!("{}/authorize", server.uri()),
            token_url: format!("{}/token", server.uri()),
            client_id: "c".into(),
            scope: DEFAULT_SCOPE.into(),
        };
        let token = exchange_refresh_token(&cfg, "PRIORREFRESH")
            .await
            .expect("refresh should succeed");
        assert_eq!(token.access_token, "NEWACCESS");
        // 일부 IdP 는 rotation 시 refresh_token 을 생략 — 우리는 None 으로 받고
        // persist_tokens 가 prior_refresh fallback 으로 메우는 형태.
        assert!(token.refresh_token.is_none());
    }
}
