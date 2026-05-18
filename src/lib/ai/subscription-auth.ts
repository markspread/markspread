// S-AI-AUTH-003 (ADR-0004): subscription sign-in 흐름 호스트 측 state machine.
//
// 실제 OAuth/디바이스 코드 흐름은 Rust 명령 `ai_auth_begin_subscription` 이
// 수행한다. 본 모듈은 그 호출의 lifecycle 을 관리하고 UI 상태를 안정적으로
// 모델링한다 (idle → starting → awaiting-user → exchanging → success | error).
//
// 테스트는 `AuthTransport` 를 fake 로 주입해 Rust 명령 호출 없이 모든 분기를
// 검증한다.

import {
  parseCredential,
  type SubscriptionCredential,
} from "./credentials";
import type { ProviderId } from "./providers";

export type AuthStage =
  | { kind: "idle" }
  | { kind: "starting" }
  | { kind: "awaiting-user"; verificationUrl: string; userCode?: string }
  | { kind: "exchanging" }
  | { kind: "success"; credential: SubscriptionCredential }
  | { kind: "error"; error: AuthError };

export type AuthErrorCode =
  | "cancelled"
  | "timeout"
  | "network"
  | "denied"
  | "invalid_token"
  | "unsupported_provider"
  | "internal";

export type AuthError = {
  code: AuthErrorCode;
  i18nKey: string;
  message: string;
};

export type AuthBeginResponse = {
  /** 사용자가 방문해야 하는 URL — 시스템 브라우저로 열린다. */
  verificationUrl: string;
  /** 디바이스 코드 흐름일 경우 사용자가 페이지에 입력할 코드. */
  userCode?: string;
  /** 토큰 교환을 위한 polling/listening 핸들. */
  sessionId: string;
};

export type AuthCompleteResponse = {
  // Rust 가 secret-storage 에 저장한 직후 반환하는 메타데이터. 토큰 자체는
  // 키체인에만 있고 메모리에는 절대 평문으로 흐르지 않는다.
  credential: SubscriptionCredential;
};

export type AuthTransport = {
  begin: (providerId: ProviderId) => Promise<AuthBeginResponse>;
  /**
   * 사용자가 브라우저에서 로그인 → 콜백 수신 → 토큰 교환까지 한 번에 대기.
   * Rust 측이 5분 타임아웃을 자체 적용한다. 사용자가 취소(브라우저 닫기)
   * 하거나 sdk 가 거부하면 throw 한다.
   */
  awaitCompletion: (sessionId: string, signal: AbortSignal) => Promise<AuthCompleteResponse>;
  cancel: (sessionId: string) => Promise<void>;
};

export type AuthFlowOptions = {
  transport: AuthTransport;
  /** UI 가 상태 변화에 반응할 수 있도록 매 단계 호출. */
  onStage?: (stage: AuthStage) => void;
};

export type AuthFlowHandle = {
  start: (providerId: ProviderId) => Promise<AuthStage>;
  cancel: () => Promise<void>;
  getStage: () => AuthStage;
};

const I18N_PREFIX = "ai.subscription.error";

const ERRORS: Record<AuthErrorCode, { i18nKey: string; message: string }> = {
  cancelled: { i18nKey: `${I18N_PREFIX}.cancelled`, message: "Sign-in cancelled" },
  timeout: { i18nKey: `${I18N_PREFIX}.timeout`, message: "Sign-in timed out" },
  network: { i18nKey: `${I18N_PREFIX}.network`, message: "Network error" },
  denied: { i18nKey: `${I18N_PREFIX}.denied`, message: "Sign-in denied" },
  invalid_token: { i18nKey: `${I18N_PREFIX}.invalid_token`, message: "Invalid token received" },
  unsupported_provider: {
    i18nKey: `${I18N_PREFIX}.unsupported_provider`,
    message: "Provider does not support subscription auth",
  },
  internal: { i18nKey: `${I18N_PREFIX}.internal`, message: "Unexpected error" },
};

function makeError(code: AuthErrorCode): AuthError {
  return { code, ...ERRORS[code] };
}

export function classifyRawError(raw: unknown): AuthError {
  const msg =
    raw instanceof Error
      ? raw.message
      : typeof raw === "string"
      ? raw
      : "";
  const lower = msg.toLowerCase();
  if (raw instanceof DOMException && raw.name === "AbortError") return makeError("cancelled");
  if (lower.includes("cancel")) return makeError("cancelled");
  if (lower.includes("timeout") || lower.includes("timed out")) return makeError("timeout");
  if (lower.includes("network") || lower.includes("fetch")) return makeError("network");
  if (lower.includes("denied") || lower.includes("unauthor")) return makeError("denied");
  if (lower.includes("invalid")) return makeError("invalid_token");
  return makeError("internal");
}

export function createSubscriptionAuthFlow(opts: AuthFlowOptions): AuthFlowHandle {
  let stage: AuthStage = { kind: "idle" };
  let activeSession: string | null = null;
  let abort: AbortController | null = null;

  function set(next: AuthStage): void {
    stage = next;
    opts.onStage?.(next);
  }

  async function start(providerId: ProviderId): Promise<AuthStage> {
    if (providerId !== "anthropic") {
      const err = makeError("unsupported_provider");
      set({ kind: "error", error: err });
      return stage;
    }
    set({ kind: "starting" });
    let begin: AuthBeginResponse;
    try {
      begin = await opts.transport.begin(providerId);
    } catch (e) {
      set({ kind: "error", error: classifyRawError(e) });
      return stage;
    }
    activeSession = begin.sessionId;
    abort = new AbortController();
    const awaitingStage: AuthStage =
      begin.userCode != null
        ? { kind: "awaiting-user", verificationUrl: begin.verificationUrl, userCode: begin.userCode }
        : { kind: "awaiting-user", verificationUrl: begin.verificationUrl };
    set(awaitingStage);
    try {
      const completion = await opts.transport.awaitCompletion(begin.sessionId, abort.signal);
      set({ kind: "exchanging" });
      const parsed = parseCredential(completion.credential);
      if (!parsed.ok || parsed.credential.kind !== "subscription") {
        set({ kind: "error", error: makeError("invalid_token") });
        return stage;
      }
      set({ kind: "success", credential: parsed.credential });
      return stage;
    } catch (e) {
      set({ kind: "error", error: classifyRawError(e) });
      return stage;
    } finally {
      activeSession = null;
      abort = null;
    }
  }

  async function cancel(): Promise<void> {
    if (abort && !abort.signal.aborted) abort.abort();
    if (activeSession) {
      try {
        await opts.transport.cancel(activeSession);
      } catch {
        // best-effort — Rust 측이 자체 정리. UI 는 cancelled stage 만 표시.
      }
    }
    if (stage.kind !== "success") {
      set({ kind: "error", error: makeError("cancelled") });
    }
  }

  function getStage(): AuthStage {
    return stage;
  }

  return { start, cancel, getStage };
}
