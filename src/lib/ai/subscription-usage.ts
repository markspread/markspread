// S-AI-AUTH-004 (ADR-0004): Claude Pro/Max 구독 응답 헤더에서 사용량을
// 파싱한다.
//
//   • anthropic-ratelimit-{requests,tokens}-{limit,remaining,reset}
//     — API key 와 동일한 시간당 한도 (단기).
//   • x-claude-subscription-quota
//     — 분기당 한도 (정확한 포맷은 SDK 응답에서 관측). JSON 형식이거나
//       `used=…; limit=…; resetAt=…` key=val 형태로 둘 다 받을 수 있도록
//       파서는 양쪽 모두 시도한다.

export type SubscriptionQuota = {
  /** 이번 분기 사용량 (tokens 또는 SDK 정의 단위). */
  used: number;
  /** 이번 분기 한도. */
  limit: number;
  /** 다음 reset (unix ms). */
  resetAt: number | null;
};

export type RateLimitWindow = {
  limit: number;
  remaining: number;
  resetAt: number | null;
};

export type SubscriptionUsageSnapshot = {
  requests?: RateLimitWindow;
  tokens?: RateLimitWindow;
  quarterly?: SubscriptionQuota;
  /** 헤더 수신 시각 (unix ms). */
  observedAt: number;
};

function parseInt10(v: string | null | undefined): number | null {
  if (v == null) return null;
  const n = Number.parseInt(v, 10);
  return Number.isFinite(n) ? n : null;
}

function parseResetTs(v: string | null | undefined): number | null {
  if (v == null) return null;
  // anthropic-ratelimit-*-reset 은 RFC3339; SDK 사용량은 unix seconds 가능.
  const asInt = Number.parseInt(v, 10);
  if (Number.isFinite(asInt) && String(asInt) === v) {
    return asInt * 1000;
  }
  const t = Date.parse(v);
  return Number.isFinite(t) ? t : null;
}

function parseQuota(raw: string | null | undefined): SubscriptionQuota | null {
  if (!raw) return null;
  // JSON 우선.
  if (raw.trim().startsWith("{")) {
    try {
      const j = JSON.parse(raw) as Record<string, unknown>;
      const used = Number(j.used);
      const limit = Number(j.limit);
      const resetAt = j.resetAt != null ? parseResetTs(String(j.resetAt)) : null;
      if (Number.isFinite(used) && Number.isFinite(limit)) {
        return { used, limit, resetAt };
      }
    } catch {
      // fall through to key=val
    }
  }
  // key=val; key=val 형태.
  const kv: Record<string, string> = {};
  for (const part of raw.split(/[;,]/)) {
    const [k, v] = part.split("=").map((s) => s.trim());
    if (k && v) kv[k.toLowerCase()] = v;
  }
  const used = Number(kv.used);
  const limit = Number(kv.limit);
  if (Number.isFinite(used) && Number.isFinite(limit)) {
    return { used, limit, resetAt: parseResetTs(kv.resetat) };
  }
  return null;
}

export function parseUsageHeaders(
  headers: Headers | Record<string, string>,
  now: number = Date.now(),
): SubscriptionUsageSnapshot {
  const get = (k: string): string | null => {
    if (headers instanceof Headers) return headers.get(k);
    return headers[k] ?? headers[k.toLowerCase()] ?? null;
  };

  const requestsLimit = parseInt10(get("anthropic-ratelimit-requests-limit"));
  const requestsRemaining = parseInt10(get("anthropic-ratelimit-requests-remaining"));
  const requestsReset = parseResetTs(get("anthropic-ratelimit-requests-reset"));

  const tokensLimit = parseInt10(get("anthropic-ratelimit-tokens-limit"));
  const tokensRemaining = parseInt10(get("anthropic-ratelimit-tokens-remaining"));
  const tokensReset = parseResetTs(get("anthropic-ratelimit-tokens-reset"));

  const quarterly = parseQuota(get("x-claude-subscription-quota"));

  const snapshot: SubscriptionUsageSnapshot = { observedAt: now };
  if (requestsLimit != null && requestsRemaining != null) {
    snapshot.requests = {
      limit: requestsLimit,
      remaining: requestsRemaining,
      resetAt: requestsReset,
    };
  }
  if (tokensLimit != null && tokensRemaining != null) {
    snapshot.tokens = {
      limit: tokensLimit,
      remaining: tokensRemaining,
      resetAt: tokensReset,
    };
  }
  if (quarterly) snapshot.quarterly = quarterly;
  return snapshot;
}

/** 구독 한도의 사용 비율 (0..1). 분기 사용량이 없으면 null. */
export function quarterlyUsageRatio(snapshot: SubscriptionUsageSnapshot): number | null {
  const q = snapshot.quarterly;
  if (!q || q.limit <= 0) return null;
  return q.used / q.limit;
}

export function isApproachingQuarterlyLimit(
  snapshot: SubscriptionUsageSnapshot,
  threshold = 0.8,
): boolean {
  const r = quarterlyUsageRatio(snapshot);
  return r != null && r >= threshold;
}

export function daysUntilReset(
  snapshot: SubscriptionUsageSnapshot,
  now: number = Date.now(),
): number | null {
  const resetAt = snapshot.quarterly?.resetAt;
  if (resetAt == null) return null;
  const ms = resetAt - now;
  if (ms <= 0) return 0;
  return Math.ceil(ms / 86_400_000);
}
