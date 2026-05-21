// S-AI-031..037: AI context assembly coverage.
//
// ms:allow-secret — the AKIA…/ghp_… strings below are synthetic fixtures
// exercising the secret-masking patterns, not real credentials.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const invokeMock = vi.fn();
vi.mock("@tauri-apps/api/core", () => ({
  invoke: (...args: unknown[]) => invokeMock(...args),
}));

import { type ContextRequest, buildContext, maskSecrets, truncateToBudget } from "../context";

beforeEach(() => {
  invokeMock.mockReset();
});

afterEach(() => {
  invokeMock.mockReset();
});

describe("maskSecrets", () => {
  it("returns input unchanged when no secrets present", () => {
    const r = maskSecrets("just normal prose");
    expect(r.text).toBe("just normal prose");
    expect(r.count).toBe(0);
  });

  it("redacts an AWS access key id", () => {
    const r = maskSecrets("key AKIAIOSFODNN7EXAMPLE here");
    expect(r.count).toBe(1);
    expect(r.text).toContain("«REDACTED:aws-akia»");
  });

  it("redacts a github token", () => {
    const r = maskSecrets(`token ghp_${"a".repeat(36)} done`);
    expect(r.count).toBe(1);
    expect(r.text).toContain("«REDACTED:github-token»");
  });

  it("redacts an openai key", () => {
    const r = maskSecrets(`sk-${"A".repeat(25)} trailing`);
    expect(r.count).toBe(1);
    expect(r.text).toContain("«REDACTED:openai-key»");
  });

  it("redacts a JWT", () => {
    const jwt = `eyJ${"a".repeat(12)}.${"b".repeat(12)}.${"c".repeat(12)}`;
    const r = maskSecrets(`auth ${jwt} end`);
    expect(r.count).toBe(1);
    expect(r.text).toContain("«REDACTED:jwt»");
  });

  it("redacts a PEM private key block", () => {
    const pem = "-----BEGIN RSA PRIVATE KEY-----\nMIIabc\n-----END RSA PRIVATE KEY-----";
    const r = maskSecrets(pem);
    expect(r.count).toBe(1);
    expect(r.text).toContain("«REDACTED:private-key-pem»");
  });

  it("counts multiple distinct secrets", () => {
    const r = maskSecrets(`AKIAIOSFODNN7EXAMPLE and ghp_${"z".repeat(36)}`);
    expect(r.count).toBe(2);
  });
});

describe("truncateToBudget", () => {
  it("returns text unchanged when within budget", () => {
    const r = truncateToBudget("short", 1000);
    expect(r.truncated).toBe(false);
    expect(r.text).toBe("short");
  });

  it("truncates from the start by default", () => {
    const text = "a".repeat(4000); // ~1000 tokens
    const r = truncateToBudget(text, 100);
    expect(r.truncated).toBe(true);
    expect(r.tokens).toBeLessThanOrEqual(120);
    expect(r.text.length).toBeLessThan(text.length);
  });

  it("keeps the tail when keepTail is set", () => {
    const text = `${"x".repeat(2000)}${"y".repeat(2000)}`;
    const r = truncateToBudget(text, 100, true);
    expect(r.truncated).toBe(true);
    expect(r.text.endsWith("y")).toBe(true);
  });
});

describe("buildContext", () => {
  const base: Omit<ContextRequest, "scope"> = {
    selection: "selected text",
    documentText: "the full document body",
    documentPath: "/notes/a.md",
    workspace: "/notes",
    tokenBudget: 1000,
  };

  it("selection scope includes only the selection", async () => {
    const r = await buildContext({ ...base, scope: "selection" });
    expect(r.sources).toHaveLength(1);
    expect(r.sources[0]?.kind).toBe("selection");
    expect(r.text).toContain("selected text");
    expect(invokeMock).not.toHaveBeenCalled();
  });

  it("selection scope with no selection yields empty payload", async () => {
    const r = await buildContext({ ...base, scope: "selection", selection: null });
    expect(r.sources).toHaveLength(0);
    expect(r.text).toBe("");
  });

  it("selection-document scope includes both selection and document", async () => {
    const r = await buildContext({ ...base, scope: "selection-document" });
    const kinds = r.sources.map((s) => s.kind);
    expect(kinds).toContain("selection");
    expect(kinds).toContain("document");
  });

  it("backlinks scope queries the rust side and adds backlink sources", async () => {
    invokeMock.mockResolvedValueOnce([{ path: "/notes/b.md", excerpt: "links here" }]);
    const r = await buildContext({ ...base, scope: "backlinks" });
    expect(invokeMock).toHaveBeenCalledWith("ai_context_backlinks", expect.any(Object));
    expect(r.sources.some((s) => s.kind === "backlink")).toBe(true);
  });

  it("backlinks scope tolerates a rust failure", async () => {
    invokeMock.mockRejectedValueOnce(new Error("no index"));
    const r = await buildContext({ ...base, scope: "backlinks" });
    expect(r.sources.some((s) => s.kind === "document")).toBe(true);
    expect(r.sources.some((s) => s.kind === "backlink")).toBe(false);
  });

  it("workspace-glob scope enumerates files", async () => {
    invokeMock.mockResolvedValueOnce([
      { path: "/notes/x.md", body: "body x" },
      { path: "/notes/y.md", body: "body y" },
    ]);
    const r = await buildContext({
      ...base,
      scope: "workspace-glob",
      glob: "**/*.md",
    });
    expect(r.sources).toHaveLength(2);
    expect(r.sources.every((s) => s.kind === "workspace")).toBe(true);
  });

  it("workspace-glob scope tolerates an enumeration failure", async () => {
    invokeMock.mockRejectedValueOnce(new Error("denied"));
    const r = await buildContext({
      ...base,
      scope: "workspace-glob",
      glob: "**/*.md",
    });
    expect(r.sources).toHaveLength(0);
  });

  it("renders '(inline)' for a null documentPath", async () => {
    const r = await buildContext({
      ...base,
      scope: "selection",
      documentPath: null as unknown as string,
    });
    expect(r.text).toContain("(inline)");
  });

  it("workspace-glob with zero files yields zero sources", async () => {
    invokeMock.mockResolvedValueOnce([]);
    const r = await buildContext({
      ...base,
      scope: "workspace-glob",
      glob: "**/*.md",
    });
    expect(r.sources).toHaveLength(0);
  });

  it("redacts secrets found in the assembled context", async () => {
    const r = await buildContext({
      ...base,
      scope: "selection",
      selection: "AKIAIOSFODNN7EXAMPLE",
    });
    expect(r.redactedSecrets).toBe(1);
    expect(r.text).toContain("«REDACTED");
  });
});
