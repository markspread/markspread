// H4 / ADR-0013: 런타임 파서 source → 등록 end-to-end logic 검증.

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { registerParserFromSource, unregisterParser } from "../register-from-source";
import { __resetParserRegistryForTests, getParserRegistry } from "../registry";

beforeEach(() => {
  __resetParserRegistryForTests();
});

afterEach(() => {
  __resetParserRegistryForTests();
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
