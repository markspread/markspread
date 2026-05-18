// S-AI-AUTH-004 (ADR-0004): subscription 토큰 만료 N 분 전 자동 갱신.
//
// 폴링 (30 초 간격) 으로 현재 자격 증명이 `shouldRefreshSubscription` 인지
// 확인. 해당되면 transport.refresh() 호출 → 성공 시 onCredentialUpdate
// 콜백으로 새 만료 시각 전파, 실패 시 onRefreshFailed 로 UI 가
// `Re-sign in` CTA + 토스트를 띄울 수 있게 알린다.
//
// 401 응답으로 호출 자체가 거부될 때 자동 fallback 은 없다 — 의도적
// 사용자 행동(다시 로그인)이 필요하다.

import {
  shouldRefreshSubscription,
  type SubscriptionCredential,
} from "./credentials";

export type RefreshFailureReason =
  | "network"
  | "denied"
  | "invalid_token"
  | "internal";

export type RefreshTransport = {
  /**
   * 현재 자격 증명의 refresh 토큰으로 새 access 토큰을 교환하고 갱신된
   * SubscriptionCredential 을 반환. 실패 시 throw — 호출자가 reason 으로
   * 분류한다.
   */
  refresh: (current: SubscriptionCredential) => Promise<SubscriptionCredential>;
};

export type AuthRefreshSchedulerOptions = {
  transport: RefreshTransport;
  /** 현재 활성 자격 증명을 반환 — 없으면 null. */
  getCurrentCredential: () => SubscriptionCredential | null;
  onCredentialUpdate: (next: SubscriptionCredential) => void;
  onRefreshFailed: (reason: RefreshFailureReason, error: Error) => void;
  /** 폴링 주기 (기본 30s). */
  pollMs?: number;
  /** 만료 lead window (기본 5분, credentials.ts 와 동일). */
  leadMs?: number;
  /** 테스트 주입용 시계. */
  now?: () => number;
};

export type AuthRefreshScheduler = {
  start: () => void;
  stop: () => void;
  /** 폴링 외에 즉시 한 번 시도 — 401 이후 UI 가 강제로 부를 수 있다. */
  runOnce: () => Promise<void>;
};

const DEFAULT_POLL_MS = 30_000;

export function createAuthRefreshScheduler(
  opts: AuthRefreshSchedulerOptions,
): AuthRefreshScheduler {
  const pollMs = opts.pollMs ?? DEFAULT_POLL_MS;
  const now = opts.now ?? Date.now;
  let timer: ReturnType<typeof setInterval> | null = null;
  let inflight = false;

  async function tick(): Promise<void> {
    if (inflight) return;
    const current = opts.getCurrentCredential();
    if (!current) return;
    if (!shouldRefreshSubscription(current, now(), opts.leadMs)) return;
    inflight = true;
    try {
      const next = await opts.transport.refresh(current);
      opts.onCredentialUpdate(next);
    } catch (e) {
      opts.onRefreshFailed(
        classifyRefreshError(e),
        e instanceof Error ? e : new Error(String(e)),
      );
    } finally {
      inflight = false;
    }
  }

  return {
    start: () => {
      if (timer) return;
      timer = setInterval(() => {
        void tick();
      }, pollMs);
    },
    stop: () => {
      if (timer) clearInterval(timer);
      timer = null;
    },
    runOnce: tick,
  };
}

export function classifyRefreshError(raw: unknown): RefreshFailureReason {
  const msg = raw instanceof Error ? raw.message.toLowerCase() : String(raw).toLowerCase();
  if (msg.includes("network") || msg.includes("fetch")) return "network";
  if (msg.includes("denied") || msg.includes("unauthor") || msg.includes("401")) return "denied";
  if (msg.includes("invalid")) return "invalid_token";
  return "internal";
}
