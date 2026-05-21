// S-AI-AUTH-004: 토큰 자동 갱신 스케줄러 회귀.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  type RefreshFailureReason,
  classifyRefreshError,
  createAuthRefreshScheduler,
} from "../auth-refresh";
import type { SubscriptionCredential } from "../credentials";

const BASE: SubscriptionCredential = {
  kind: "subscription",
  providerId: "anthropic",
  alias: "default",
  encryptedAccessToken: "enc::at",
  encryptedRefreshToken: "enc::rt",
  expiresAt: 0,
  accountLabel: "swlee@example.com",
};

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

describe("createAuthRefreshScheduler", () => {
  it("refreshes when current credential falls inside the lead window", async () => {
    const now = 10_000_000;
    vi.setSystemTime(now);
    const current: SubscriptionCredential = { ...BASE, expiresAt: now + 60_000 };
    const next: SubscriptionCredential = { ...BASE, expiresAt: now + 3_600_000 };
    const onCredentialUpdate = vi.fn();
    const onRefreshFailed = vi.fn();
    const refresh = vi.fn(async () => next);
    const sched = createAuthRefreshScheduler({
      transport: { refresh },
      getCurrentCredential: () => current,
      onCredentialUpdate,
      onRefreshFailed,
      pollMs: 1000,
      now: () => now,
    });
    sched.start();
    await vi.advanceTimersByTimeAsync(1100);
    expect(refresh).toHaveBeenCalledWith(current);
    expect(onCredentialUpdate).toHaveBeenCalledWith(next);
    expect(onRefreshFailed).not.toHaveBeenCalled();
    sched.stop();
  });

  it("does not refresh when the credential is far from expiry", async () => {
    const now = 10_000_000;
    const current: SubscriptionCredential = { ...BASE, expiresAt: now + 30 * 60_000 };
    const refresh = vi.fn();
    const sched = createAuthRefreshScheduler({
      transport: { refresh },
      getCurrentCredential: () => current,
      onCredentialUpdate: vi.fn(),
      onRefreshFailed: vi.fn(),
      pollMs: 1000,
      now: () => now,
    });
    sched.start();
    await vi.advanceTimersByTimeAsync(5000);
    expect(refresh).not.toHaveBeenCalled();
    sched.stop();
  });

  it("emits onRefreshFailed when transport throws", async () => {
    const now = 10_000_000;
    const current: SubscriptionCredential = { ...BASE, expiresAt: now + 60_000 };
    const onRefreshFailed = vi.fn();
    const sched = createAuthRefreshScheduler({
      transport: {
        refresh: async () => {
          throw new Error("HTTP 401 unauthorized");
        },
      },
      getCurrentCredential: () => current,
      onCredentialUpdate: vi.fn(),
      onRefreshFailed,
      pollMs: 1000,
      now: () => now,
    });
    sched.start();
    await vi.advanceTimersByTimeAsync(1100);
    expect(onRefreshFailed).toHaveBeenCalledTimes(1);
    expect(onRefreshFailed.mock.calls[0]?.[0]).toBe("denied");
    sched.stop();
  });

  it("skips when no credential is currently signed in", async () => {
    const refresh = vi.fn();
    const sched = createAuthRefreshScheduler({
      transport: { refresh },
      getCurrentCredential: () => null,
      onCredentialUpdate: vi.fn(),
      onRefreshFailed: vi.fn(),
      pollMs: 500,
    });
    sched.start();
    await vi.advanceTimersByTimeAsync(2000);
    expect(refresh).not.toHaveBeenCalled();
    sched.stop();
  });

  it("runOnce triggers an immediate refresh", async () => {
    const now = 10_000_000;
    const current: SubscriptionCredential = { ...BASE, expiresAt: now + 60_000 };
    const refresh = vi.fn(async () => ({ ...current, expiresAt: now + 3_600_000 }));
    const sched = createAuthRefreshScheduler({
      transport: { refresh },
      getCurrentCredential: () => current,
      onCredentialUpdate: vi.fn(),
      onRefreshFailed: vi.fn(),
      now: () => now,
    });
    await sched.runOnce();
    expect(refresh).toHaveBeenCalledTimes(1);
  });

  it("does not stack concurrent refreshes", async () => {
    const now = 10_000_000;
    const current: SubscriptionCredential = { ...BASE, expiresAt: now + 60_000 };
    let release!: (v: SubscriptionCredential) => void;
    const refresh = vi.fn(
      () =>
        new Promise<SubscriptionCredential>((resolve) => {
          release = resolve;
        }),
    );
    const sched = createAuthRefreshScheduler({
      transport: { refresh },
      getCurrentCredential: () => current,
      onCredentialUpdate: vi.fn(),
      onRefreshFailed: vi.fn(),
      pollMs: 100,
      now: () => now,
    });
    sched.start();
    await vi.advanceTimersByTimeAsync(120);
    await vi.advanceTimersByTimeAsync(120);
    await vi.advanceTimersByTimeAsync(120);
    expect(refresh).toHaveBeenCalledTimes(1);
    release({ ...current, expiresAt: now + 3_600_000 });
    sched.stop();
  });

  it("start() is idempotent", () => {
    const sched = createAuthRefreshScheduler({
      transport: { refresh: vi.fn() },
      getCurrentCredential: () => null,
      onCredentialUpdate: vi.fn(),
      onRefreshFailed: vi.fn(),
      pollMs: 1000,
    });
    sched.start();
    sched.start(); // second call should be a no-op
    sched.stop();
  });

  it("wraps non-Error throws in an Error before forwarding", async () => {
    const now = 10_000_000;
    const current: SubscriptionCredential = { ...BASE, expiresAt: now + 60_000 };
    const onRefreshFailed = vi.fn();
    const sched = createAuthRefreshScheduler({
      transport: {
        refresh: async () => {
          throw "string error";
        },
      },
      getCurrentCredential: () => current,
      onCredentialUpdate: vi.fn(),
      onRefreshFailed,
      pollMs: 1000,
      now: () => now,
    });
    sched.start();
    await vi.advanceTimersByTimeAsync(1100);
    expect(onRefreshFailed.mock.calls[0]?.[1]).toBeInstanceOf(Error);
    expect((onRefreshFailed.mock.calls[0]?.[1] as Error).message).toBe("string error");
    sched.stop();
  });

  it("stop() halts further polling", async () => {
    const now = 10_000_000;
    const current: SubscriptionCredential = { ...BASE, expiresAt: now + 60_000 };
    const refresh = vi.fn(async () => current);
    const sched = createAuthRefreshScheduler({
      transport: { refresh },
      getCurrentCredential: () => current,
      onCredentialUpdate: vi.fn(),
      onRefreshFailed: vi.fn(),
      pollMs: 100,
      now: () => now,
    });
    sched.start();
    await vi.advanceTimersByTimeAsync(120);
    sched.stop();
    const callsAfterStop = refresh.mock.calls.length;
    await vi.advanceTimersByTimeAsync(500);
    expect(refresh.mock.calls.length).toBe(callsAfterStop);
  });
});

describe("classifyRefreshError", () => {
  const cases: Array<[string, RefreshFailureReason]> = [
    ["network unreachable", "network"],
    ["fetch error", "network"],
    ["401 unauthorized", "denied"],
    ["access denied", "denied"],
    ["invalid token format", "invalid_token"],
    ["weird boom", "internal"],
  ];
  for (const [input, expected] of cases) {
    it(`maps "${input}" → ${expected}`, () => {
      expect(classifyRefreshError(new Error(input))).toBe(expected);
    });
  }

  it("classifies a non-Error throw by its string form", () => {
    expect(classifyRefreshError("network down")).toBe("network");
  });
});
