// ADR-0016 (T5.G): TrustRegistry 단위 테스트.

import { describe, expect, it } from "vitest";
import { TrustRegistry, iconFor, policyFor } from "../trust-registry";

describe("policyFor", () => {
  it("local: no validation, no consent, sanitizer toggle allowed", () => {
    const p = policyFor("local");
    expect(p).toEqual({
      validateAst: false,
      sanitizerStrict: false,
      requireConsent: false,
      shortIdle: false,
    });
  });

  it("llm-generated: validate + consent required, sanitizer toggleable", () => {
    const p = policyFor("llm-generated");
    expect(p).toEqual({
      validateAst: true,
      sanitizerStrict: false,
      requireConsent: true,
      shortIdle: false,
    });
  });

  it("imported: most strict — sanitizer always strict, short idle", () => {
    const p = policyFor("imported");
    expect(p).toEqual({
      validateAst: true,
      sanitizerStrict: true,
      requireConsent: true,
      shortIdle: true,
    });
  });
});

describe("iconFor", () => {
  it("returns the documented IconName per level", () => {
    expect(iconFor("local")).toBe("lock");
    expect(iconFor("llm-generated")).toBe("bot");
    expect(iconFor("imported")).toBe("shield");
  });
});

describe("TrustRegistry — register + level", () => {
  it("registers a plugin with assignedAt", () => {
    const r = new TrustRegistry();
    const entry = r.register("wireweave", "local", { now: 100 });
    expect(entry.pluginName).toBe("wireweave");
    expect(entry.level).toBe("local");
    expect(entry.assignedAt).toBe(100);
    expect(r.level("wireweave")).toBe("local");
  });

  it("returns null level for unknown plugin", () => {
    const r = new TrustRegistry();
    expect(r.level("ghost")).toBeNull();
  });

  it("idempotent register at the same level returns same entry", () => {
    const r = new TrustRegistry();
    const a = r.register("p", "llm-generated", { now: 100 });
    const b = r.register("p", "llm-generated", { now: 200 });
    expect(a.assignedAt).toBe(100); // 첫 등록 시각 유지
    expect(b).toBe(a);
  });

  it("upgrades strictness (local → llm-generated → imported)", () => {
    const r = new TrustRegistry();
    r.register("p", "local", { now: 0 });
    r.register("p", "llm-generated", { now: 1 });
    expect(r.level("p")).toBe("llm-generated");
    r.register("p", "imported", { now: 2 });
    expect(r.level("p")).toBe("imported");
  });

  it("rejects downgrade — caller must reset() first", () => {
    const r = new TrustRegistry();
    r.register("p", "imported", { now: 0 });
    expect(() => r.register("p", "local", { now: 1 })).toThrow(/cannot downgrade/);
  });

  it("reset() allows re-registration at any level", () => {
    const r = new TrustRegistry();
    r.register("p", "imported", { now: 0 });
    r.reset("p");
    r.register("p", "local", { now: 1 });
    expect(r.level("p")).toBe("local");
  });
});

describe("TrustRegistry — consent", () => {
  it("local plugins are always consented (skip dialog)", () => {
    const r = new TrustRegistry();
    r.register("p", "local", { now: 0 });
    expect(r.hasConsent("p")).toBe(true);
  });

  it("llm-generated requires explicit consent", () => {
    const r = new TrustRegistry();
    r.register("p", "llm-generated", { now: 0 });
    expect(r.hasConsent("p")).toBe(false);
    r.recordConsent("p", 50);
    expect(r.hasConsent("p")).toBe(true);
  });

  it("imported requires explicit consent (same as llm-generated)", () => {
    const r = new TrustRegistry();
    r.register("p", "imported", { now: 0 });
    expect(r.hasConsent("p")).toBe(false);
    r.recordConsent("p", 50);
    expect(r.hasConsent("p")).toBe(true);
  });

  it("recordConsent throws for unknown plugin", () => {
    const r = new TrustRegistry();
    expect(() => r.recordConsent("ghost", 0)).toThrow(/unknown plugin/);
  });

  it("unknown plugins are NOT consented", () => {
    const r = new TrustRegistry();
    expect(r.hasConsent("ghost")).toBe(false);
  });
});

describe("TrustRegistry — policy()", () => {
  it("returns level-derived policy for known plugin", () => {
    const r = new TrustRegistry();
    r.register("p", "llm-generated", { now: 0 });
    const p = r.policy("p");
    expect(p.validateAst).toBe(true);
    expect(p.requireConsent).toBe(true);
  });

  it("returns most-strict policy (imported) for unknown plugin — safety default", () => {
    const r = new TrustRegistry();
    const p = r.policy("ghost");
    expect(p.sanitizerStrict).toBe(true);
    expect(p.shortIdle).toBe(true);
  });
});

describe("TrustRegistry — list + metadata", () => {
  it("captures authoredBy for llm-generated", () => {
    const r = new TrustRegistry();
    r.register("p", "llm-generated", { now: 0, authoredBy: "claude-sonnet-4-6" });
    const [first] = r.list();
    if (!first) throw new Error("expected an entry");
    expect(first.authoredBy).toBe("claude-sonnet-4-6");
  });

  it("captures origin for imported", () => {
    const r = new TrustRegistry();
    r.register("p", "imported", {
      now: 0,
      origin: "https://github.com/markspread/parser-figjam",
    });
    const [first] = r.list();
    if (!first) throw new Error("expected an entry");
    expect(first.origin).toBe("https://github.com/markspread/parser-figjam");
  });

  it("size tracks entries", () => {
    const r = new TrustRegistry();
    expect(r.size()).toBe(0);
    r.register("a", "local", { now: 0 });
    r.register("b", "imported", { now: 0 });
    expect(r.size()).toBe(2);
    r.reset("a");
    expect(r.size()).toBe(1);
  });

  it("list() returns defensive copies (mutation does not leak)", () => {
    const r = new TrustRegistry();
    r.register("p", "local", { now: 0 });
    const snapshot = r.list();
    (snapshot[0] as { level: string }).level = "imported"; // mutate copy
    expect(r.level("p")).toBe("local");
  });
});
