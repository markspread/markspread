// S-AI-AUTH-004: 구독 사용량 헤더 파싱 + 80% 배너 회귀.

import { describe, expect, it } from "vitest";
import {
  daysUntilReset,
  isApproachingQuarterlyLimit,
  parseUsageHeaders,
  quarterlyUsageRatio,
} from "../subscription-usage";

describe("parseUsageHeaders", () => {
  it("parses anthropic-ratelimit-{requests,tokens} headers", () => {
    const snap = parseUsageHeaders(
      {
        "anthropic-ratelimit-requests-limit": "1000",
        "anthropic-ratelimit-requests-remaining": "900",
        "anthropic-ratelimit-requests-reset": "1778712000",
        "anthropic-ratelimit-tokens-limit": "1000000",
        "anthropic-ratelimit-tokens-remaining": "800000",
        "anthropic-ratelimit-tokens-reset": "2026-05-15T00:00:00Z",
      },
      1_000_000,
    );
    expect(snap.requests).toEqual({ limit: 1000, remaining: 900, resetAt: 1778712000 * 1000 });
    expect(snap.tokens?.limit).toBe(1_000_000);
    expect(snap.tokens?.remaining).toBe(800_000);
    expect(snap.tokens?.resetAt).toBe(Date.parse("2026-05-15T00:00:00Z"));
  });

  it("parses x-claude-subscription-quota as JSON", () => {
    const snap = parseUsageHeaders({
      "x-claude-subscription-quota":
        '{"used": 4500000, "limit": 6000000, "resetAt": "2026-06-30T23:59:59Z"}',
    });
    expect(snap.quarterly).toEqual({
      used: 4_500_000,
      limit: 6_000_000,
      resetAt: Date.parse("2026-06-30T23:59:59Z"),
    });
  });

  it("parses x-claude-subscription-quota as key=val", () => {
    const snap = parseUsageHeaders({
      "x-claude-subscription-quota":
        "used=4500000; limit=6000000; resetAt=1782345600",
    });
    expect(snap.quarterly?.used).toBe(4_500_000);
    expect(snap.quarterly?.limit).toBe(6_000_000);
    expect(snap.quarterly?.resetAt).toBe(1782345600 * 1000);
  });

  it("supports Headers instance input", () => {
    const h = new Headers({
      "anthropic-ratelimit-tokens-limit": "10",
      "anthropic-ratelimit-tokens-remaining": "3",
    });
    const snap = parseUsageHeaders(h);
    expect(snap.tokens?.remaining).toBe(3);
  });

  it("omits sections when their headers are absent", () => {
    const snap = parseUsageHeaders({});
    expect(snap.requests).toBeUndefined();
    expect(snap.tokens).toBeUndefined();
    expect(snap.quarterly).toBeUndefined();
  });
});

describe("quarterly limit signalling", () => {
  it("computes the usage ratio", () => {
    const snap = parseUsageHeaders({
      "x-claude-subscription-quota": '{"used":80,"limit":100}',
    });
    expect(quarterlyUsageRatio(snap)).toBeCloseTo(0.8, 5);
  });

  it("returns null when no quarterly data is present", () => {
    expect(quarterlyUsageRatio(parseUsageHeaders({}))).toBeNull();
  });

  it("flags 80% as approaching the limit", () => {
    const snap = parseUsageHeaders({
      "x-claude-subscription-quota": '{"used":80,"limit":100}',
    });
    expect(isApproachingQuarterlyLimit(snap)).toBe(true);
  });

  it("does not flag below the default threshold", () => {
    const snap = parseUsageHeaders({
      "x-claude-subscription-quota": '{"used":70,"limit":100}',
    });
    expect(isApproachingQuarterlyLimit(snap)).toBe(false);
  });

  it("honors a custom threshold", () => {
    const snap = parseUsageHeaders({
      "x-claude-subscription-quota": '{"used":70,"limit":100}',
    });
    expect(isApproachingQuarterlyLimit(snap, 0.5)).toBe(true);
  });
});

describe("daysUntilReset", () => {
  it("returns days until quarterly reset", () => {
    const now = Date.parse("2026-05-14T00:00:00Z");
    const snap = parseUsageHeaders(
      {
        "x-claude-subscription-quota":
          '{"used":1,"limit":2,"resetAt":"2026-05-24T00:00:00Z"}',
      },
      now,
    );
    expect(daysUntilReset(snap, now)).toBe(10);
  });

  it("returns 0 when reset already passed", () => {
    const now = Date.parse("2026-05-14T00:00:00Z");
    const snap = parseUsageHeaders({
      "x-claude-subscription-quota":
        '{"used":1,"limit":2,"resetAt":"2026-05-01T00:00:00Z"}',
    });
    expect(daysUntilReset(snap, now)).toBe(0);
  });

  it("returns null when no quarterly reset is known", () => {
    expect(daysUntilReset(parseUsageHeaders({}), 0)).toBeNull();
  });
});
