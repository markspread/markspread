// S-AI-AUTH-003: Tauri 기반 AuthTransport 구현체. Rust 명령
// `ai_auth_begin_subscription` / `ai_auth_await_completion` /
// `ai_auth_cancel` 을 호출한다. jsdom 환경에서는 `@tauri-apps/api/core` 가
// invoke 를 호출할 수 없으므로 호스트 부팅 시 한 번만 import 하는 게 안전.

import { invoke } from "@tauri-apps/api/core";
import type { SubscriptionCredential } from "./credentials";
import type { ProviderId } from "./providers";
import type { AuthBeginResponse, AuthCompleteResponse, AuthTransport } from "./subscription-auth";

type RustAuthBeginResponse = {
  verificationUrl: string;
  userCode?: string;
  sessionId: string;
};

type RustAuthCompleteResponse = {
  providerId: "anthropic";
  alias: string;
  expiresAt: number;
  accountLabel?: string;
};

export function createTauriAuthTransport(): AuthTransport {
  return {
    async begin(providerId: ProviderId): Promise<AuthBeginResponse> {
      const r = await invoke<RustAuthBeginResponse>("ai_auth_begin_subscription", {
        providerId,
      });
      return r.userCode != null
        ? { verificationUrl: r.verificationUrl, userCode: r.userCode, sessionId: r.sessionId }
        : { verificationUrl: r.verificationUrl, sessionId: r.sessionId };
    },
    async awaitCompletion(sessionId, signal): Promise<AuthCompleteResponse> {
      // Rust 측이 5분 타임아웃 + cancel handle 을 자체 보유. abort 신호는
      // ai_auth_cancel 로 전달.
      signal.addEventListener("abort", () => {
        void invoke("ai_auth_cancel", { sessionId }).catch(() => {});
      });
      const r = await invoke<RustAuthCompleteResponse>("ai_auth_await_completion", {
        sessionId,
      });
      // 토큰 자체는 Rust 측 키체인에만 — TS 는 메타데이터만 받는다. 호스트
      // 코드(useAiKeyStore 등)가 keychain entry 이름을 알고 호출하므로 여기서는
      // encrypted* 필드에 placeholder 를 채워 union 형태만 맞춘다.
      const credential: SubscriptionCredential =
        r.accountLabel != null
          ? {
              kind: "subscription",
              providerId: "anthropic",
              alias: r.alias,
              encryptedAccessToken: "keychain://ai-keys/anthropic/subscription#access",
              encryptedRefreshToken: "keychain://ai-keys/anthropic/subscription#refresh",
              expiresAt: r.expiresAt,
              accountLabel: r.accountLabel,
            }
          : {
              kind: "subscription",
              providerId: "anthropic",
              alias: r.alias,
              encryptedAccessToken: "keychain://ai-keys/anthropic/subscription#access",
              encryptedRefreshToken: "keychain://ai-keys/anthropic/subscription#refresh",
              expiresAt: r.expiresAt,
            };
      return { credential };
    },
    async cancel(sessionId): Promise<void> {
      try {
        await invoke("ai_auth_cancel", { sessionId });
      } catch {
        // best-effort
      }
    },
  };
}
