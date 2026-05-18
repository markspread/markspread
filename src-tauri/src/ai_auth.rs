// S-AI-AUTH-003 (ADR-0004): Claude Agent SDK 구독 인증 흐름의 Rust 측 골격.
//
// 본 모듈은 OAuth / 디바이스 코드 흐름의 라이프사이클을 관리하는 *공개
// 명령 표면* 만 정의한다. 실제 SDK 호출은 후속 커밋(`ai_auth::backend`)에서
// 채워진다 — 이 첫 등록은 프론트엔드(`subscription-auth.ts`) 가 import 할
// 안정된 시그니처를 박아둔다.
//
// 보안:
//   • 토큰은 keyring 서비스 `com.markspread.app`,
//     아이템 `ai-keys/anthropic/subscription` 에만 보관한다.
//   • 평문 토큰은 절대 IPC 로 흐르지 않는다 — front 는 메타데이터(만료,
//     account label) 만 받는다.
//   • 5분 타임아웃 + 명시적 `cancel` 만 세션을 종료한다.

use serde::{Deserialize, Serialize};

use crate::error::AppError;

/// Front-end 가 begin 호출에 받는 응답. 토큰 자체는 포함되지 않는다.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AuthBeginResponse {
    /// 사용자가 시스템 브라우저에서 방문할 URL.
    pub verification_url: String,
    /// 디바이스 코드 흐름에서 사용자가 페이지에 입력할 코드.
    /// PKCE 흐름이면 None.
    pub user_code: Option<String>,
    /// `awaitCompletion(sessionId)` 으로 polling 할 세션 핸들.
    pub session_id: String,
}

/// 토큰 교환 완료 시 반환되는 메타데이터. 토큰은 키체인 안에 있다.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AuthCompleteResponse {
    pub provider_id: String,
    pub alias: String,
    /// unix ms.
    pub expires_at: i64,
    /// e.g. "swlee@example.com" — 표시 라벨.
    pub account_label: Option<String>,
}

/// S-AI-AUTH-003: subscription 흐름 시작. 후속 구현은 Agent SDK 의
/// OAuth / device code endpoint 를 호출해 verification URL 을 반환한다.
#[tauri::command]
pub async fn ai_auth_begin_subscription(
    provider_id: String,
) -> Result<AuthBeginResponse, AppError> {
    if provider_id != "anthropic" {
        return Err(AppError::Invalid(format!(
            "subscription auth not supported for provider '{provider_id}'"
        )));
    }
    // The SDK integration lives in a follow-up commit; the command is
    // wired now so the renderer-side state machine can target a stable
    // signature.
    Err(AppError::Invalid(
        "Claude Agent SDK subscription auth backend not yet wired".into(),
    ))
}

/// 토큰 교환 완료 polling. 세션이 5분 안에 닫히지 않으면 timeout 으로 실패.
#[tauri::command]
pub async fn ai_auth_await_completion(
    session_id: String,
) -> Result<AuthCompleteResponse, AppError> {
    let _ = session_id;
    Err(AppError::Invalid(
        "Claude Agent SDK subscription auth backend not yet wired".into(),
    ))
}

/// 진행 중인 세션 취소. 호출자 측 UI 가 명시적으로 사용자가 취소했다고
/// 판단한 경우에만 호출. (브라우저 닫기 감지는 SDK 가 자체 timeout 처리.)
#[tauri::command]
pub async fn ai_auth_cancel(session_id: String) -> Result<(), AppError> {
    let _ = session_id;
    Ok(())
}

/// 부팅 시 `auth-refresh-boot.ts` 가 호출한다. 키체인 아이템
/// `ai-keys/anthropic/subscription` 에 구독 토큰이 보관돼 있을 때만
/// 메타데이터를 반환한다. 평문 토큰은 절대 반환하지 않는다.
///
/// 구독 인증 backend (Agent SDK) 가 아직 연결되지 않았으므로 보관된
/// 자격증명이 존재할 수 없다 — 항상 `None` 을 반환해 스케줄러가 조용히
/// 부팅을 건너뛰게 한다.
#[tauri::command]
pub async fn ai_keys_get_subscription() -> Result<Option<AuthCompleteResponse>, AppError> {
    use crate::ops::KEYCHAIN_SERVICE;
    // 키체인에 항목이 실제로 있으면 메타데이터 파일을 함께 읽어야 하지만,
    // begin/await 흐름이 stub 이라 항목이 기록될 경로가 없다.
    let stored = keyring::Entry::new(KEYCHAIN_SERVICE, "ai-keys/anthropic/subscription")
        .ok()
        .and_then(|e| e.get_password().ok());
    if stored.is_none() {
        return Ok(None);
    }
    // 토큰은 존재하지만 메타데이터 사이드카가 아직 정의되지 않았다.
    Ok(None)
}

/// 구독 OAuth 토큰 갱신. Agent SDK refresh endpoint 가 연결되면 채워진다.
#[tauri::command]
pub async fn ai_auth_refresh_subscription(alias: String) -> Result<AuthCompleteResponse, AppError> {
    let _ = alias;
    Err(AppError::Invalid(
        "Claude Agent SDK subscription auth backend not yet wired".into(),
    ))
}
