// T-U15-003: AuthRefreshScheduler boot wiring.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { SubscriptionCredential } from "../credentials";

const invokeMock = vi.fn();
vi.mock("@tauri-apps/api/core", () => ({
  invoke: (...args: unknown[]) => invokeMock(...args),
}));

const schedulerStart = vi.fn();
const schedulerStop = vi.fn();
type SchedulerOpts = {
  transport: { refresh: (c: SubscriptionCredential) => Promise<SubscriptionCredential> };
  getCurrentCredential: () => SubscriptionCredential | null;
  onCredentialUpdate: (next: SubscriptionCredential) => void;
  onRefreshFailed: (reason: string, err: Error) => void;
};
let lastOpts: SchedulerOpts | null = null;
vi.mock("../auth-refresh", () => ({
  createAuthRefreshScheduler: (opts: SchedulerOpts) => {
    lastOpts = opts;
    return { start: schedulerStart, stop: schedulerStop, runOnce: vi.fn() };
  },
}));

import { startAuthRefreshScheduler, stopAuthRefreshScheduler } from "../auth-refresh-boot";

const CRED: SubscriptionCredential = {
  kind: "subscription",
  providerId: "anthropic",
  alias: "default",
  encryptedAccessToken: "keychain://x",
  encryptedRefreshToken: "keychain://y",
  expiresAt: Date.now() + 3_600_000,
  accountLabel: "swlee@example.com",
};

beforeEach(() => {
  invokeMock.mockReset();
  schedulerStart.mockReset();
  schedulerStop.mockReset();
  lastOpts = null;
  stopAuthRefreshScheduler();
});

afterEach(() => {
  stopAuthRefreshScheduler();
});

describe("startAuthRefreshScheduler", () => {
  it("boots a scheduler when a subscription credential is present", async () => {
    invokeMock.mockResolvedValueOnce(CRED);
    await startAuthRefreshScheduler();
    expect(schedulerStart).toHaveBeenCalledTimes(1);
    expect(lastOpts?.getCurrentCredential()).toEqual(CRED);
  });

  it("does nothing when there is no current credential", async () => {
    invokeMock.mockResolvedValueOnce(null);
    await startAuthRefreshScheduler();
    expect(schedulerStart).not.toHaveBeenCalled();
  });

  it("skips the boot when the keychain query throws", async () => {
    invokeMock.mockRejectedValueOnce(new Error("keychain unavailable"));
    await startAuthRefreshScheduler();
    expect(schedulerStart).not.toHaveBeenCalled();
  });

  it("is idempotent — second call is a no-op while active", async () => {
    invokeMock.mockResolvedValueOnce(CRED);
    await startAuthRefreshScheduler();
    await startAuthRefreshScheduler();
    expect(schedulerStart).toHaveBeenCalledTimes(1);
  });

  it("the refresh transport delegates to ai_auth_refresh_subscription", async () => {
    invokeMock.mockResolvedValueOnce(CRED);
    await startAuthRefreshScheduler();
    const next: SubscriptionCredential = { ...CRED, expiresAt: CRED.expiresAt + 3_600_000 };
    invokeMock.mockResolvedValueOnce(next);
    const result = await lastOpts?.transport.refresh(CRED);
    expect(invokeMock).toHaveBeenLastCalledWith("ai_auth_refresh_subscription", {
      alias: CRED.alias,
    });
    expect(result).toEqual(next);
  });

  it("onCredentialUpdate swaps the credential surfaced to getCurrentCredential", async () => {
    invokeMock.mockResolvedValueOnce(CRED);
    await startAuthRefreshScheduler();
    const next: SubscriptionCredential = { ...CRED, expiresAt: CRED.expiresAt + 1_000 };
    lastOpts?.onCredentialUpdate(next);
    expect(lastOpts?.getCurrentCredential()).toEqual(next);
  });

  it("onRefreshFailed logs without throwing", async () => {
    invokeMock.mockResolvedValueOnce(CRED);
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    await startAuthRefreshScheduler();
    lastOpts?.onRefreshFailed("denied", new Error("HTTP 401"));
    expect(warn).toHaveBeenCalledWith("[ai-auth-refresh]", "denied", "HTTP 401");
    warn.mockRestore();
  });
});

describe("stopAuthRefreshScheduler", () => {
  it("stops the active scheduler and clears state", async () => {
    invokeMock.mockResolvedValueOnce(CRED);
    await startAuthRefreshScheduler();
    stopAuthRefreshScheduler();
    expect(schedulerStop).toHaveBeenCalledTimes(1);
    // After stop a fresh start should boot again.
    invokeMock.mockResolvedValueOnce(CRED);
    await startAuthRefreshScheduler();
    expect(schedulerStart).toHaveBeenCalledTimes(2);
  });

  it("is safe to call when no scheduler is active", () => {
    expect(() => stopAuthRefreshScheduler()).not.toThrow();
  });
});
