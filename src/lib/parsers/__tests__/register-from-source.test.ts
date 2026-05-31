// H4 / ADR-0013: 런타임 파서 source → 등록 end-to-end logic 검증.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { getOrchestrator, resetOrchestrator } from "../../plugins/runtime/orchestrator-singleton";
import { registerParserFromSource, unregisterParser } from "../register-from-source";
import { __resetParserRegistryForTests, getParserRegistry } from "../registry";

beforeEach(() => {
  __resetParserRegistryForTests();
  resetOrchestrator();
});

afterEach(() => {
  __resetParserRegistryForTests();
  resetOrchestrator();
  vi.restoreAllMocks();
});

describe("registerParserFromSource — happy path", () => {
  it("registers a simple factory + makes it discoverable via match", () => {
    const r = registerParserFromSource({
      id: "wireweave",
      displayName: "WireWeave",
      extensions: [".wireweave", ".ww"],
      source: `(input) => ({ ast: { kind: "html", html: "<svg>" + input.content + "</svg>" } })`,
    });
    expect(r.ok).toBe(true);

    const matched = getParserRegistry().match({ path: "/ws/diagram.wireweave" });
    expect(matched).not.toBeNull();
    expect(matched?.parser.manifest.id).toBe("wireweave");
  });

  it("accepts 'export default fn' syntax", () => {
    const r = registerParserFromSource({
      id: "exp",
      displayName: "Exp",
      extensions: [".exp"],
      source: `export default (input) => ({ ast: { kind: "html", html: input.content } })`,
    });
    expect(r.ok).toBe(true);
  });

  it("accepts 'module.exports = fn' syntax", () => {
    const r = registerParserFromSource({
      id: "cjs",
      displayName: "CJS",
      extensions: [".cjs-doc"],
      source: `module.exports = (input) => ({ ast: { kind: "html", html: input.content } })`,
    });
    expect(r.ok).toBe(true);
  });

  it("registered factory actually produces ast on parse", () => {
    registerParserFromSource({
      id: "echo",
      displayName: "Echo",
      extensions: [".echo"],
      source: `(input) => ({ ast: { kind: "html", html: "echo:" + input.content } })`,
    });
    const matched = getParserRegistry().match({ path: "/x.echo" });
    if (!matched) throw new Error("expected match");
    const out = matched.parser.factory({ content: "hi", path: "/x.echo", encoding: "utf-8" });
    expect((out as { ast: { kind: string; html: string } }).ast.html).toBe("echo:hi");
  });
});

describe("registerParserFromSource — validation + safety", () => {
  it("reports validator violations even on successful registration", () => {
    const r = registerParserFromSource({
      id: "with-fetch",
      displayName: "fetcher",
      extensions: [".f"],
      // 'fetch(' violates Validator network_fetch rule
      source: `(input) => { fetch("/x"); return { ast: { kind: "html", html: input.content } }; }`,
    });
    // Registration succeeds but caller sees violations to surface in UI.
    expect(r.ok).toBe(true);
    expect(r.violations.some((v) => v.code === "network_fetch")).toBe(true);
  });

  it("fails on syntax error in source", () => {
    const r = registerParserFromSource({
      id: "bad",
      displayName: "bad",
      extensions: [".bad"],
      source: "(input) => { return malformed!!!@@ ",
    });
    expect(r.ok).toBe(false);
    expect(r.error).toBeTruthy();
  });

  it("fails when source returns non-function", () => {
    const r = registerParserFromSource({
      id: "noobj",
      displayName: "noobj",
      extensions: [".no"],
      source: "42",
    });
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/must be a function/);
  });

  it("wraps a non-{ast} factory return value into a raw AST (line 70 / branch 69)", () => {
    // Registration succeeds; the factory's *runtime* return is a bare value
    // (no `ast` key) → evaluateFactory's wrapper coerces it to { ast: raw }.
    registerParserFromSource({
      id: "bare-return",
      displayName: "bare",
      extensions: [".bare"],
      // returns a plain string, NOT an object with `ast`.
      source: `(input) => "just-text:" + input.content`,
    });
    const matched = getParserRegistry().match({ path: "/x.bare" });
    if (!matched) throw new Error("expected match");
    const out = matched.parser.factory({ content: "hi", path: "/x.bare", encoding: "utf-8" });
    expect(out).toEqual({ ast: { kind: "raw", value: "just-text:hi" } });
  });

  it("normalises a non-Error throw from evaluation (branch 73)", () => {
    // The eval body throws a *string*, not an Error → evaluateFactory's
    // `e instanceof Error ? e : new Error(String(e))` takes the else branch.
    const r = registerParserFromSource({
      id: "throw-string",
      displayName: "ts",
      extensions: [".ts-doc"],
      source: `(() => { throw "plain-string-failure" })()`,
    });
    expect(r.ok).toBe(false);
    expect(r.error).toBe("plain-string-failure");
  });

  it("returns ok:false when the registry rejects the manifest (lines 100-106)", () => {
    // Pre-occupy the id directly in the registry so registerParser throws
    // "already registered".
    getParserRegistry().registerParser(
      {
        id: "dup-id",
        version: "9.9.9",
        displayName: "pre-existing",
        fileMatch: { extensions: [".pre"] },
        capabilities: "preview-only",
        entry: "test:pre",
      },
      (input) => ({ ast: { kind: "html", html: input.content } }),
    );
    const r = registerParserFromSource({
      id: "dup-id",
      displayName: "dup",
      extensions: [".dup"],
      source: `(input) => ({ ast: { kind: "html", html: input.content } })`,
    });
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/already registered/);
  });

  it("stringifies a non-Error thrown by the registry (line 104 String(e) branch)", () => {
    // registerParser normally throws an Error; force a *non-Error* throw so the
    // `e instanceof Error ? e.message : String(e)` else-branch is taken.
    vi.spyOn(getParserRegistry(), "registerParser").mockImplementation(() => {
      throw "raw-string-rejection";
    });
    const r = registerParserFromSource({
      id: "nonerr-reg",
      displayName: "ne",
      extensions: [".ne"],
      source: `(input) => ({ ast: { kind: "html", html: input.content } })`,
    });
    expect(r.ok).toBe(false);
    expect(r.error).toBe("raw-string-rejection");
  });

  it("survives a trust-registry rejection (downgrade) — still ok:true (lines 118-121)", () => {
    // Pre-register the trust entry at the stricter "imported" level. The
    // register-from-source flow then tries to register it as the *weaker*
    // "llm-generated" level → trust.register throws (downgrade blocked). The
    // catch swallows it (console.warn) and registration still succeeds.
    getOrchestrator().trust.register("downgrade-id", "imported", { now: 1 });
    const r = registerParserFromSource({
      id: "downgrade-id",
      displayName: "dg",
      extensions: [".dg"],
      source: `(input) => ({ ast: { kind: "html", html: input.content } })`,
    });
    expect(r.ok).toBe(true);
    // Parser is still discoverable despite the trust hiccup.
    expect(getParserRegistry().match({ path: "/x.dg" })?.parser.manifest.id).toBe("downgrade-id");
  });
});

describe("unregisterParser", () => {
  it("removes a previously registered parser (falls back to markdown)", () => {
    registerParserFromSource({
      id: "rm-test",
      displayName: "rm",
      extensions: [".rm"],
      source: `(input) => ({ ast: { kind: "html", html: input.content } })`,
    });
    const before = getParserRegistry().match({ path: "/x.rm" });
    expect(before?.parser.manifest.id).toBe("rm-test");
    unregisterParser("rm-test");
    // After unregister, match returns either null or the markdown fallback (NOT rm-test).
    const after = getParserRegistry().match({ path: "/x.rm" });
    expect(after?.parser.manifest.id).not.toBe("rm-test");
  });

  it("swallows a trust.reset() failure (lines 133-135 catch branch)", () => {
    registerParserFromSource({
      id: "rm-trust-throw",
      displayName: "rm2",
      extensions: [".rm2"],
      source: `(input) => ({ ast: { kind: "html", html: input.content } })`,
    });
    // Force trust.reset to throw so unregisterParser's try/catch is exercised.
    vi.spyOn(getOrchestrator().trust, "reset").mockImplementation(() => {
      throw new Error("reset boom");
    });
    // Must not throw — the catch ignores it.
    expect(() => unregisterParser("rm-trust-throw")).not.toThrow();
    // Parser is still removed from the registry regardless.
    expect(getParserRegistry().match({ path: "/x.rm2" })?.parser.manifest.id).not.toBe(
      "rm-trust-throw",
    );
  });
});

describe("end-to-end — user creates wireweave parser, opens .wireweave file", () => {
  it("registered parser is the one returned for the matching extension", () => {
    registerParserFromSource({
      id: "wireweave-e2e",
      displayName: "WireWeave E2E",
      extensions: [".wireweave"],
      source: `(input) => ({ ast: { kind: "html", html: '<div class="ww">' + input.content + '</div>' } })`,
    });
    const matched = getParserRegistry().match({ path: "/docs/diagram.wireweave" });
    expect(matched?.parser.manifest.id).toBe("wireweave-e2e");
    // SpreadPane would call this factory with the file content
    const out = matched?.parser.factory({
      content: "A -> B",
      path: "/docs/diagram.wireweave",
      encoding: "utf-8",
    });
    expect((out as { ast: { kind: string; html: string } }).ast.html).toContain('class="ww"');
    expect((out as { ast: { kind: string; html: string } }).ast.html).toContain("A -> B");
  });
});
