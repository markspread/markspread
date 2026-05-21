// S-AI-AUTH-003: subscription sign-in 흐름 상태 머신 회귀.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { SubscriptionCredential } from "../credentials";
import {
  type AuthStage,
  type AuthTransport,
  classifyRawError,
  createSubscriptionAuthFlow,
} from "../subscription-auth";

function freshCred(over: Partial<SubscriptionCredential> = {}): SubscriptionCredential {
  return {
    kind: "subscription",
    providerId: "anthropic",
    alias: "default",
    encryptedAccessToken: "enc::at",
    encryptedRefreshToken: "enc::rt",
    expiresAt: Date.now() + 3600_000,
    accountLabel: "swlee@example.com",
    ...over,
  };
}

function makeTransport(over: Partial<AuthTransport> = {}): AuthTransport {
  return {
    begin: async () => ({ verificationUrl: "https://claude.ai/oauth", sessionId: "s1" }),
    awaitCompletion: async () => ({ credential: freshCred() }),
    cancel: async () => {},
    ...over,
  };
}

let stages: AuthStage[] = [];
beforeEach(() => {
  stages = [];
});
afterEach(() => {
  vi.restoreAllMocks();
});

describe("createSubscriptionAuthFlow", () => {
  it("walks idle → starting → awaiting-user → exchanging → success", async () => {
    const flow = createSubscriptionAuthFlow({
      transport: makeTransport({
        begin: async () => ({
          verificationUrl: "https://claude.ai/device",
          userCode: "ABCD-1234",
          sessionId: "s1",
        }),
      }),
      onStage: (s) => stages.push(s),
    });
    const final = await flow.start("anthropic");
    expect(stages.map((s) => s.kind)).toEqual([
      "starting",
      "awaiting-user",
      "exchanging",
      "success",
    ]);
    const awaiting = stages[1] as Extract<AuthStage, { kind: "awaiting-user" }>;
    expect(awaiting.verificationUrl).toBe("https://claude.ai/device");
    expect(awaiting.userCode).toBe("ABCD-1234");
    expect(final.kind).toBe("success");
  });

  it("classifies an OAuth denial as 'denied'", async () => {
    const flow = createSubscriptionAuthFlow({
      transport: makeTransport({
        awaitCompletion: async () => {
          throw new Error("user denied authorization");
        },
      }),
      onStage: (s) => stages.push(s),
    });
    const final = await flow.start("anthropic");
    expect(final.kind).toBe("error");
    if (final.kind === "error") expect(final.error.code).toBe("denied");
  });

  it("classifies a network failure", async () => {
    const flow = createSubscriptionAuthFlow({
      transport: makeTransport({
        begin: async () => {
          throw new Error("fetch failed: network unreachable");
        },
      }),
    });
    const final = await flow.start("anthropic");
    expect(final.kind).toBe("error");
    if (final.kind === "error") expect(final.error.code).toBe("network");
  });

  it("classifies a timeout", async () => {
    const flow = createSubscriptionAuthFlow({
      transport: makeTransport({
        awaitCompletion: async () => {
          throw new Error("device code polling timed out");
        },
      }),
    });
    const final = await flow.start("anthropic");
    expect(final.kind).toBe("error");
    if (final.kind === "error") expect(final.error.code).toBe("timeout");
  });

  it("rejects providers that don't support subscription", async () => {
    const flow = createSubscriptionAuthFlow({ transport: makeTransport() });
    const final = await flow.start("openai");
    expect(final.kind).toBe("error");
    if (final.kind === "error") expect(final.error.code).toBe("unsupported_provider");
  });

  it("rejects an invalid credential returned by the transport", async () => {
    const flow = createSubscriptionAuthFlow({
      transport: makeTransport({
        awaitCompletion: async () =>
          ({ credential: { kind: "subscription", providerId: "openai" } }) as never,
      }),
    });
    const final = await flow.start("anthropic");
    expect(final.kind).toBe("error");
    if (final.kind === "error") expect(final.error.code).toBe("invalid_token");
  });

  it("rejects when transport returns a non-subscription credential shape", async () => {
    const flow = createSubscriptionAuthFlow({
      transport: makeTransport({
        awaitCompletion: async () =>
          ({
            credential: {
              kind: "api-key",
              providerId: "anthropic",
              alias: "default",
              encryptedKey: "enc::k",
            },
          }) as never,
      }),
    });
    const final = await flow.start("anthropic");
    expect(final.kind).toBe("error");
    if (final.kind === "error") expect(final.error.code).toBe("invalid_token");
  });

  it("cancel() during awaiting-user moves the stage to cancelled error", async () => {
    const cancelSpy = vi.fn();
    let resolveAwait!: (v: { credential: SubscriptionCredential }) => void;
    const awaitPromise = new Promise<{ credential: SubscriptionCredential }>((resolve, reject) => {
      resolveAwait = resolve;
      // signal abort handler
      void reject;
    });
    const transport = makeTransport({
      awaitCompletion: async (_sessionId, signal) =>
        new Promise((resolve, reject) => {
          signal.addEventListener("abort", () => reject(new Error("cancelled by user")));
          // also wire externally
          void awaitPromise.then(resolve);
        }),
      cancel: cancelSpy,
    });
    const flow = createSubscriptionAuthFlow({
      transport,
      onStage: (s) => stages.push(s),
    });
    const p = flow.start("anthropic");
    // give the awaiting-user stage a chance to materialise
    await Promise.resolve();
    await Promise.resolve();
    await flow.cancel();
    const final = await p;
    expect(final.kind).toBe("error");
    if (final.kind === "error") expect(final.error.code).toBe("cancelled");
    expect(cancelSpy).toHaveBeenCalledWith("s1");
    void resolveAwait; // unused — included for shape only
  });

  it("swallows transport.cancel() failures during cancel()", async () => {
    const cancelSpy = vi.fn(async () => {
      throw new Error("rust side already dropped");
    });
    const transport = makeTransport({
      awaitCompletion: async (_sessionId, signal) =>
        new Promise((_resolve, reject) => {
          signal.addEventListener("abort", () => reject(new Error("cancelled by user")));
        }),
      cancel: cancelSpy,
    });
    const flow = createSubscriptionAuthFlow({ transport });
    const p = flow.start("anthropic");
    await Promise.resolve();
    await Promise.resolve();
    await flow.cancel();
    const final = await p;
    expect(final.kind).toBe("error");
    expect(cancelSpy).toHaveBeenCalled();
  });

  it("exposes the current stage via getStage()", async () => {
    const flow = createSubscriptionAuthFlow({ transport: makeTransport() });
    expect(flow.getStage().kind).toBe("idle");
    await flow.start("anthropic");
    expect(flow.getStage().kind).toBe("success");
  });
});

describe("classifyRawError", () => {
  it("maps AbortError to cancelled", () => {
    const e = new DOMException("aborted", "AbortError");
    expect(classifyRawError(e).code).toBe("cancelled");
  });
  it("maps unknown to internal", () => {
    expect(classifyRawError({}).code).toBe("internal");
  });
  it("includes a stable i18n key", () => {
    expect(classifyRawError(new Error("network")).i18nKey).toMatch(/^ai\.subscription\.error\./);
  });
  it("classifies a plain string message", () => {
    expect(classifyRawError("network unreachable").code).toBe("network");
  });
  it("classifies an 'invalid' message as invalid_token", () => {
    expect(classifyRawError(new Error("invalid token from sdk")).code).toBe("invalid_token");
  });
  it("classifies a 'cancel' message as cancelled", () => {
    expect(classifyRawError(new Error("user cancelled")).code).toBe("cancelled");
  });
});
