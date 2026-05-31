// ADR-0016 (T5.F): 활성 동의 로직 단위 테스트.

import { describe, expect, it, vi } from "vitest";
import {
  applyConsentDecision,
  evaluateConsent,
  recommendationFor,
  summariseViolations,
} from "../consent";
import { TrustRegistry } from "../trust-registry";
import type { Violation } from "../validator";

function payload(extra: Partial<Parameters<typeof evaluateConsent>[2]> = {}) {
  return {
    fullSource: "export function md(s){return s}",
    oneLinerSummary: "uppercase markdown",
    violations: [],
    ...extra,
  };
}

describe("evaluateConsent — branches", () => {
  it("unknown-plugin when trust not registered", () => {
    const r = new TrustRegistry();
    expect(evaluateConsent("ghost", r, payload()).action).toBe("unknown-plugin");
  });

  it("skip-local for local trust", () => {
    const r = new TrustRegistry();
    r.register("p", "local", { now: 0 });
    expect(evaluateConsent("p", r, payload()).action).toBe("skip-local");
  });

  it("show for llm-generated without prior consent", () => {
    const r = new TrustRegistry();
    r.register("p", "llm-generated", { now: 0 });
    const result = evaluateConsent("p", r, payload({ oneLinerSummary: "do X" }));
    expect(result.action).toBe("show");
    expect(result.prompt?.pluginName).toBe("p");
    expect(result.prompt?.oneLinerSummary).toBe("do X");
    expect(result.prompt?.trustLevel).toBe("llm-generated");
    expect(result.prompt?.fullSource).toContain("export function");
  });

  it("show for imported without prior consent", () => {
    const r = new TrustRegistry();
    r.register("p", "imported", { now: 0 });
    expect(evaluateConsent("p", r, payload()).action).toBe("show");
  });

  it("already-consented after recordConsent", () => {
    const r = new TrustRegistry();
    r.register("p", "llm-generated", { now: 0 });
    r.recordConsent("p", 5);
    expect(evaluateConsent("p", r, payload()).action).toBe("already-consented");
  });
});

describe("evaluateConsent — prompt content", () => {
  it("forwards violations to the prompt", () => {
    const r = new TrustRegistry();
    r.register("p", "llm-generated", { now: 0 });
    const v: Violation[] = [
      {
        code: "eval",
        span: { line: 1, column: 1, length: 5 },
        message: "eval()",
        snippet: "eval(",
      },
    ];
    const result = evaluateConsent("p", r, payload({ violations: v }));
    expect(result.prompt?.violations).toHaveLength(1);
    expect(result.prompt?.violations[0]?.code).toBe("eval");
  });

  it("fallback oneLinerSummary when missing", () => {
    const r = new TrustRegistry();
    r.register("p", "llm-generated", { now: 0 });
    const result = evaluateConsent("p", r, payload({ oneLinerSummary: "" }));
    expect(result.prompt?.oneLinerSummary).toBe("(요약 없음)");
  });

  it("defaults violations to [] when omitted from payload", () => {
    const r = new TrustRegistry();
    r.register("p", "llm-generated", { now: 0 });
    // payload without a `violations` key → nullish-coalesce to [].
    const result = evaluateConsent("p", r, {
      fullSource: "export function md(s){return s}",
      oneLinerSummary: "x",
    });
    expect(result.action).toBe("show");
    expect(result.prompt?.violations).toEqual([]);
  });
});

describe("applyConsentDecision", () => {
  it("accept records consent + activates", () => {
    const r = new TrustRegistry();
    r.register("p", "llm-generated", { now: 0 });
    const { activated } = applyConsentDecision("p", "accept", r, 10);
    expect(activated).toBe(true);
    expect(r.hasConsent("p")).toBe(true);
  });

  it("reject does NOT record consent, NOT activated", () => {
    const r = new TrustRegistry();
    r.register("p", "llm-generated", { now: 0 });
    const { activated } = applyConsentDecision("p", "reject", r, 10);
    expect(activated).toBe(false);
    expect(r.hasConsent("p")).toBe(false);
  });

  it("skip is no-op", () => {
    const r = new TrustRegistry();
    r.register("p", "llm-generated", { now: 0 });
    const { activated } = applyConsentDecision("p", "skip", r, 10);
    expect(activated).toBe(false);
    expect(r.hasConsent("p")).toBe(false);
  });
});

describe("summariseViolations", () => {
  it("empty → 통과 메시지", () => {
    expect(summariseViolations([])).toMatch(/통과/);
  });

  it("formats each violation with line/column/code", () => {
    const s = summariseViolations([
      { code: "eval", span: { line: 3, column: 5, length: 4 }, message: "eval()", snippet: "eval" },
      {
        code: "network_fetch",
        span: { line: 8, column: 1, length: 5 },
        message: "fetch()",
        snippet: "fetch",
      },
    ]);
    expect(s).toContain("L3:5");
    expect(s).toContain("eval");
    expect(s).toContain("L8:1");
    expect(s).toContain("network_fetch");
    expect(s).toMatch(/2건/);
  });
});

describe("recommendationFor", () => {
  it("local recommendation mentions immediate activation", () => {
    expect(recommendationFor("local")).toMatch(/즉시 활성/);
  });

  it("llm-generated recommendation suggests reviewing full code", () => {
    expect(recommendationFor("llm-generated")).toMatch(/전체 코드/);
  });

  it("imported recommendation mentions origin verification", () => {
    expect(recommendationFor("imported")).toMatch(/origin|외부/);
  });
});

// `policyFor("imported").sanitizerStrict` is always true in production, so the
// non-strict imported arm (consent.ts:118) is unreachable through the public
// API. We isolate-import with `policyFor` stubbed to return a non-strict policy
// to exercise that fallback branch without touching production source.
describe("recommendationFor — imported with non-strict policy (injected)", () => {
  it("returns the bare external-source fallback when sanitizerStrict is false", async () => {
    vi.resetModules();
    vi.doMock("../trust-registry", () => ({
      policyFor: () => ({ sanitizerStrict: false }),
    }));
    const { recommendationFor: rec } = await import("../consent");
    expect(rec("imported")).toBe("외부 출처입니다.");
    vi.doUnmock("../trust-registry");
    vi.resetModules();
  });
});
