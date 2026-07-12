// H4 / ADR-0013: 런타임 파서 source → 등록 end-to-end logic 검증.
//
// SC-SEC-01..04 계약 (R1 수정): 등록은 Validator 게이트를 통과해야 하고,
// llm-generated 소스는 메인스레드에서 실행되지 않으며(guard factory),
// 활성 동의(Accept) 후에만 Worker transport 가 붙는다.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { getOrchestrator, resetOrchestrator } from "../../plugins/runtime/orchestrator-singleton";
import {
  evaluateFactory,
  registerParserFromSource,
  resolveParserConsent,
  unregisterParser,
} from "../register-from-source";
import { __resetParserRegistryForTests, getParserRegistry } from "../registry";
import { __resetRuntimeParserTransportsForTests } from "../runtime-transport";
import { __resetParserTransportsForTests, getParserTransport } from "../transport-registry";

beforeEach(() => {
  __resetParserRegistryForTests();
  resetOrchestrator();
  __resetParserTransportsForTests();
  __resetRuntimeParserTransportsForTests();
});

afterEach(() => {
  __resetParserRegistryForTests();
  resetOrchestrator();
  __resetParserTransportsForTests();
  __resetRuntimeParserTransportsForTests();
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

  it("SC-SEC-01: registry factory is a guard — user code never runs in-process", () => {
    // 계약 갱신 (R1): 이전엔 factory 가 메인스레드에서 user 코드를 실행했다.
    // 이제 registry factory 는 sandbox-only guard 이고 실행은 Worker transport
    // (renderInSandbox) 경로에서만 일어난다.
    registerParserFromSource({
      id: "echo",
      displayName: "Echo",
      extensions: [".echo"],
      source: `(input) => ({ ast: { kind: "html", html: "echo:" + input.content } })`,
    });
    const matched = getParserRegistry().match({ path: "/x.echo" });
    if (!matched) throw new Error("expected match");
    const out = matched.parser.factory({ content: "hi", path: "/x.echo", encoding: "utf-8" });
    const ast = (out as { ast: { kind: string; value?: string } }).ast;
    expect(ast.kind).toBe("raw");
    expect(String(ast.value)).toContain("sandbox 전용");
    expect(String(ast.value)).not.toContain("echo:hi");
  });

  it("SC-SEC-04: consent Accept 후에만 Worker transport 가 등록된다", () => {
    const r = registerParserFromSource({
      id: "consent-flow",
      displayName: "CF",
      extensions: [".cf"],
      source: `(input) => ({ ast: { kind: "html", html: input.content } })`,
    });
    expect(r.ok).toBe(true);
    expect(r.activated).toBe(false);
    expect(r.consent?.action).toBe("show");
    expect(r.consent?.prompt?.fullSource).toContain("input.content");
    // 미동의 상태 — transport 없음 + 동의 기록 없음.
    expect(getParserTransport("consent-flow")).toBeNull();
    expect(getOrchestrator().trust.hasConsent("consent-flow")).toBe(false);
    // Accept → recordConsent + transport 활성.
    const { activated } = resolveParserConsent("consent-flow", "accept");
    expect(activated).toBe(true);
    expect(getOrchestrator().trust.hasConsent("consent-flow")).toBe(true);
    expect(getParserTransport("consent-flow")).not.toBeNull();
  });

  it("SC-SEC-04: consent Reject 는 등록을 롤백한다", () => {
    registerParserFromSource({
      id: "consent-reject",
      displayName: "CR",
      extensions: [".cr"],
      source: `(input) => ({ ast: { kind: "html", html: input.content } })`,
    });
    const { activated } = resolveParserConsent("consent-reject", "reject");
    expect(activated).toBe(false);
    expect(getParserRegistry().match({ path: "/x.cr" })?.parser.manifest.id).not.toBe(
      "consent-reject",
    );
    expect(getParserTransport("consent-reject")).toBeNull();
  });

  it("재등록(교체)은 기존 동의를 유지한다 — T5.F '수정마다 X'", () => {
    registerParserFromSource({
      id: "re-apply",
      displayName: "RA",
      extensions: [".ra"],
      source: `(input) => ({ ast: { kind: "html", html: "v1" } })`,
    });
    resolveParserConsent("re-apply", "accept");
    const second = registerParserFromSource({
      id: "re-apply",
      displayName: "RA",
      extensions: [".ra"],
      source: `(input) => ({ ast: { kind: "html", html: "v2" } })`,
    });
    expect(second.ok).toBe(true);
    expect(second.consent?.action).toBe("already-consented");
    expect(second.activated).toBe(true);
  });
});

describe("registerParserFromSource — validation + safety", () => {
  it("SC-SEC-02: validator violation rejects registration (ok:false + violations)", () => {
    // 계약 갱신 (R1): 이전 "성공 + 위반 표시" 는 확정 결함 — 위반 = 등록 거부.
    const r = registerParserFromSource({
      id: "with-fetch",
      displayName: "fetcher",
      extensions: [".f"],
      // 'fetch(' violates Validator network_fetch rule
      source: `(input) => { fetch("/x"); return { ast: { kind: "html", html: input.content } }; }`,
    });
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/거부/);
    expect(r.violations.some((v) => v.code === "network_fetch")).toBe(true);
    // Registry 미등록.
    expect(getParserRegistry().match({ path: "/x.f" })?.parser.manifest.id).not.toBe("with-fetch");
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

  it("accepts a non-function source at registration — shape 오류는 Worker 평가로 이연", () => {
    // 계약 갱신 (R1 / SC-SEC-01): 등록 시점 검사는 *컴파일 전용* 이다 —
    // untrusted 소스를 메인스레드에서 실행(평가)하지 않으므로 "42 는 함수가
    // 아님" 은 Worker 안 평가 시 parse:err 로 표면화된다 (runtime-transport
    // 테스트가 고정). IIFE throw 같은 실행 부작용도 등록 시점에는 발생하지
    // 않는다 — 그것이 곧 격리다.
    const r = registerParserFromSource({
      id: "noobj",
      displayName: "noobj",
      extensions: [".no"],
      source: "42",
    });
    expect(r.ok).toBe(true);
    expect(r.consent?.action).toBe("show");
  });

  it("registration does NOT execute untrusted top-level code (SC-SEC-01)", () => {
    // 이전 계약에선 IIFE 가 등록 시점 메인스레드에서 실행됐다("plain-string-failure"
    // 를 동기로 받았음) — 그 실행 자체가 SC-SEC-01 결함. 이제 컴파일만 한다.
    const marker = vi.fn();
    (globalThis as { __ms_sec_marker__?: unknown }).__ms_sec_marker__ = marker;
    const r = registerParserFromSource({
      id: "no-exec",
      displayName: "ne",
      extensions: [".ne"],
      source: `(() => { globalThis.__ms_sec_marker__(); return (i) => ({ ast: { kind: "raw", value: i.content } }); })()`,
    });
    expect(r.ok).toBe(true);
    expect(marker).not.toHaveBeenCalled();
    (globalThis as { __ms_sec_marker__?: unknown }).__ms_sec_marker__ = undefined;
  });

  it("evaluateFactory (local-trust 경로) wraps a non-{ast} return into a raw AST", () => {
    // evaluateFactory 는 디스크 hot-reload(local trust, ADR-0012 C1) 전용으로
    // 남는다 — wrapper 계약을 직접 고정.
    const factory = evaluateFactory(`(input) => "just-text:" + input.content`);
    if (factory instanceof Error) throw factory;
    const out = factory({ content: "hi", path: "/x.bare", encoding: "utf-8" });
    expect(out).toEqual({ ast: { kind: "raw", value: "just-text:hi" } });
  });

  it("evaluateFactory normalises a non-Error throw from evaluation", () => {
    const result = evaluateFactory(`(() => { throw "plain-string-failure" })()`);
    expect(result).toBeInstanceOf(Error);
    expect((result as Error).message).toBe("plain-string-failure");
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
  it("registered parser matches the extension; execution stays sandbox-only", () => {
    registerParserFromSource({
      id: "wireweave-e2e",
      displayName: "WireWeave E2E",
      extensions: [".wireweave"],
      source: `(input) => ({ ast: { kind: "html", html: '<div class="ww">' + input.content + '</div>' } })`,
    });
    resolveParserConsent("wireweave-e2e", "accept");
    const matched = getParserRegistry().match({ path: "/docs/diagram.wireweave" });
    expect(matched?.parser.manifest.id).toBe("wireweave-e2e");
    // SC-SEC-01 계약: SpreadPane(render.ts) 은 이 factory 를 직접 호출하지
    // 않는다 — 실행은 transport-registry 의 Worker transport 로만. factory 는
    // guard (사용자 코드 미실행). 실제 sandbox 렌더는 preview 의
    // parser-security.dom.test 가 고정한다.
    expect(getParserTransport("wireweave-e2e")).not.toBeNull();
    const out = matched?.parser.factory({
      content: "A -> B",
      path: "/docs/diagram.wireweave",
      encoding: "utf-8",
    });
    const ast = (out as { ast: { kind: string; value?: string } }).ast;
    expect(ast.kind).toBe("raw");
    expect(String(ast.value)).not.toContain("A -> B");
  });
});
