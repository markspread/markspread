// S-AIK-006..008: "Test connection" classification coverage.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const invokeMock = vi.fn();
vi.mock("@tauri-apps/api/core", () => ({
  invoke: (...args: unknown[]) => invokeMock(...args),
}));

import { type TestRequest, describeTestOutcome, testConnection } from "../key-test";

const req: TestRequest = {
  provider: "anthropic",
  model: "claude-opus-4-7",
  baseUrl: null,
  key: "sk-test",
};

beforeEach(() => invokeMock.mockReset());
afterEach(() => invokeMock.mockReset());

describe("testConnection", () => {
  it("returns ok with latency when the provider accepts the key", async () => {
    invokeMock.mockResolvedValueOnce({ status: 200, ok: true, message: "", modelId: "m1" });
    const r = await testConnection(req);
    expect(r.kind).toBe("ok");
    if (r.kind === "ok") {
      expect(r.modelId).toBe("m1");
      expect(r.latencyMs).toBeGreaterThanOrEqual(0);
    }
  });

  it("classifies a 401 as auth", async () => {
    invokeMock.mockResolvedValueOnce({ status: 401, ok: false, message: "bad key" });
    const r = await testConnection(req);
    expect(r.kind).toBe("auth");
    if (r.kind === "auth") expect(r.status).toBe(401);
  });

  it("classifies a 403 as auth", async () => {
    invokeMock.mockResolvedValueOnce({ status: 403, ok: false, message: "" });
    const r = await testConnection(req);
    expect(r.kind).toBe("auth");
  });

  it("classifies a 500 as other", async () => {
    invokeMock.mockResolvedValueOnce({ status: 500, ok: false, message: "" });
    const r = await testConnection(req);
    expect(r.kind).toBe("other");
    if (r.kind === "other") expect(r.status).toBe(500);
  });

  it("classifies a network-prefixed error as network", async () => {
    invokeMock.mockRejectedValueOnce(new Error("network: connection refused"));
    const r = await testConnection(req);
    expect(r.kind).toBe("network");
    if (r.kind === "network") expect(r.message).toBe("connection refused");
  });

  it("classifies a non-prefixed thrown error as other", async () => {
    invokeMock.mockRejectedValueOnce(new Error("boom"));
    const r = await testConnection(req);
    expect(r.kind).toBe("other");
    if (r.kind === "other") expect(r.status).toBe(0);
  });

  it("stringifies non-Error throws", async () => {
    invokeMock.mockRejectedValueOnce("plain string");
    const r = await testConnection(req);
    expect(r.kind).toBe("other");
    if (r.kind === "other") expect(r.message).toBe("plain string");
  });

  it("passes an abort cookie when a signal is supplied", async () => {
    invokeMock.mockResolvedValueOnce({ status: 200, ok: true, message: "" });
    await testConnection(req, new AbortController().signal);
    const args = invokeMock.mock.calls[0]?.[1] as { abortCookie: string | null };
    expect(args.abortCookie).not.toBeNull();
  });
});

describe("describeTestOutcome", () => {
  it("describes ok", () => {
    expect(describeTestOutcome({ kind: "ok", latencyMs: 42 }).i18nKey).toBe("ai.test.ok");
  });

  it("describes auth", () => {
    const d = describeTestOutcome({ kind: "auth", status: 401, message: "x" });
    expect(d.detail).toBe("HTTP 401");
  });

  it("describes network", () => {
    expect(describeTestOutcome({ kind: "network", message: "down" }).detail).toBe("down");
  });

  it("describes other", () => {
    expect(describeTestOutcome({ kind: "other", status: 500, message: "e" }).i18nKey).toBe(
      "ai.test.other",
    );
  });
});
