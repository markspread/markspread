// S-AI-AUTH-003: Tauri AuthTransport wiring.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const invokeMock = vi.fn();
vi.mock("@tauri-apps/api/core", () => ({
  invoke: (...args: unknown[]) => invokeMock(...args),
}));

import { createTauriAuthTransport } from "../subscription-auth-tauri";

beforeEach(() => {
  invokeMock.mockReset();
});

afterEach(() => {
  invokeMock.mockReset();
});

describe("createTauriAuthTransport.begin", () => {
  it("returns the device code response when a userCode is present", async () => {
    invokeMock.mockResolvedValueOnce({
      verificationUrl: "https://claude.ai/device",
      userCode: "ABCD-1234",
      sessionId: "s-1",
    });
    const r = await createTauriAuthTransport().begin("anthropic");
    expect(invokeMock).toHaveBeenCalledWith("ai_auth_begin_subscription", {
      providerId: "anthropic",
    });
    expect(r).toEqual({
      verificationUrl: "https://claude.ai/device",
      userCode: "ABCD-1234",
      sessionId: "s-1",
    });
  });

  it("omits userCode when absent", async () => {
    invokeMock.mockResolvedValueOnce({
      verificationUrl: "https://claude.ai/oauth",
      sessionId: "s-2",
    });
    const r = await createTauriAuthTransport().begin("anthropic");
    expect(r).toEqual({ verificationUrl: "https://claude.ai/oauth", sessionId: "s-2" });
    expect("userCode" in r).toBe(false);
  });
});

describe("createTauriAuthTransport.awaitCompletion", () => {
  it("returns a credential with the accountLabel when provided", async () => {
    invokeMock.mockResolvedValueOnce({
      providerId: "anthropic",
      alias: "default",
      expiresAt: 1_900_000_000,
      accountLabel: "swlee@example.com",
    });
    const controller = new AbortController();
    const r = await createTauriAuthTransport().awaitCompletion("sess", controller.signal);
    expect(invokeMock).toHaveBeenCalledWith("ai_auth_await_completion", { sessionId: "sess" });
    expect(r.credential).toMatchObject({
      kind: "subscription",
      providerId: "anthropic",
      alias: "default",
      expiresAt: 1_900_000_000,
      accountLabel: "swlee@example.com",
    });
    expect(r.credential.encryptedAccessToken).toMatch(/^keychain:\/\//);
    expect(r.credential.encryptedRefreshToken).toMatch(/^keychain:\/\//);
  });

  it("returns a credential without accountLabel when none is returned", async () => {
    invokeMock.mockResolvedValueOnce({
      providerId: "anthropic",
      alias: "alt",
      expiresAt: 1_800_000_000,
    });
    const controller = new AbortController();
    const r = await createTauriAuthTransport().awaitCompletion("sess", controller.signal);
    expect(r.credential.accountLabel).toBeUndefined();
    expect(r.credential.alias).toBe("alt");
  });

  it("invokes ai_auth_cancel when the abort signal fires", async () => {
    invokeMock.mockImplementation(async (cmd: string) => {
      if (cmd === "ai_auth_await_completion") {
        return { providerId: "anthropic", alias: "default", expiresAt: 1_800_000_000 };
      }
      return undefined;
    });
    const controller = new AbortController();
    const pending = createTauriAuthTransport().awaitCompletion("abort-sess", controller.signal);
    controller.abort();
    await pending;
    await Promise.resolve();
    expect(invokeMock).toHaveBeenCalledWith("ai_auth_cancel", { sessionId: "abort-sess" });
  });

  it("swallows errors from the cancel side-effect", async () => {
    invokeMock.mockImplementation(async (cmd: string) => {
      if (cmd === "ai_auth_await_completion") {
        return { providerId: "anthropic", alias: "default", expiresAt: 1_800_000_000 };
      }
      throw new Error("already cancelled");
    });
    const controller = new AbortController();
    const pending = createTauriAuthTransport().awaitCompletion("sess", controller.signal);
    controller.abort();
    await pending;
    await new Promise((r) => setTimeout(r, 0));
    expect(invokeMock).toHaveBeenCalledWith("ai_auth_cancel", { sessionId: "sess" });
  });
});

describe("createTauriAuthTransport.cancel", () => {
  it("invokes ai_auth_cancel with the session id", async () => {
    invokeMock.mockResolvedValueOnce(undefined);
    await createTauriAuthTransport().cancel("sess-x");
    expect(invokeMock).toHaveBeenCalledWith("ai_auth_cancel", { sessionId: "sess-x" });
  });

  it("swallows errors from ai_auth_cancel", async () => {
    invokeMock.mockRejectedValueOnce(new Error("rust dropped"));
    await expect(createTauriAuthTransport().cancel("sess-y")).resolves.toBeUndefined();
  });
});
