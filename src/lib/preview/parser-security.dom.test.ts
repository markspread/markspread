// SC-SEC-01..04 (R1 Fix-D) 통합 회귀: ADR-0012/0016 의 다층 방어가 *라이브
// 실행 경로* (registerParserFromSource → render()) 에 실제로 합성돼 있는지
// 고정한다. R1 의 결함 클래스는 "모듈 완성 + 유닛 green + 배선 부재" 였으므로
// 본 스위트는 모듈 목킹 없이 실제 registry / trust / transport / render 를
// 관통한다 (Worker 만 in-process 에뮬레이션 — worker bootstrap 스크립트 자체를
// 실행하는 고충실도 fake).

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { useToasts } from "../../store/toasts";
import { registerParserFromSource, resolveParserConsent } from "../parsers/register-from-source";
import { __resetParserRegistryForTests, getParserRegistry } from "../parsers/registry";
import type { SandboxTransport } from "../parsers/renderer-host";
import {
  __resetRuntimeParserTransportsForTests,
  createInProcessParserTransportForTests,
  getRuntimeParserSuspension,
  setRuntimeParserTransportFactoryForTests,
} from "../parsers/runtime-transport";
import { __resetParserTransportsForTests, getParserTransport } from "../parsers/transport-registry";
import { resetOrchestrator } from "../plugins/runtime/orchestrator-singleton";
import { render } from "./render";

beforeEach(() => {
  __resetParserRegistryForTests();
  resetOrchestrator();
  __resetParserTransportsForTests();
  __resetRuntimeParserTransportsForTests();
  useToasts.setState({ toasts: [] });
  setRuntimeParserTransportFactoryForTests(createInProcessParserTransportForTests);
});

afterEach(() => {
  __resetParserRegistryForTests();
  resetOrchestrator();
  __resetParserTransportsForTests();
  __resetRuntimeParserTransportsForTests();
  useToasts.setState({ toasts: [] });
});

const OK_SOURCE = `(input) => ({ ast: { kind: "html", html: '<p data-sec="ok">SBX:' + input.content + '</p>' } })`;

function registerAndConsent(id: string, ext: string, source: string) {
  const r = registerParserFromSource({
    id,
    displayName: id,
    extensions: [ext],
    source,
  });
  if (!r.ok) throw new Error(`register failed: ${r.error}`);
  if (r.consent?.action === "show") resolveParserConsent(id, "accept");
  return r;
}

describe("SC-SEC-01 — 런타임 파서 렌더는 Worker 격리 경로만 탄다", () => {
  it("render() dispatches through the registered sandbox transport", async () => {
    registerAndConsent("sec-iso", ".sec1", OK_SOURCE);
    const out = await render("DOC-BODY", { path: "/ws/a.sec1" });
    expect(out).toContain('data-sec="ok"');
    expect(out).toContain("SBX:DOC-BODY");
  });

  it("transport 부재 시 in-process 강등 없이 차단 카드를 렌더한다", async () => {
    registerAndConsent("sec-noport", ".sec2", OK_SOURCE);
    // transport 를 제거해 "격리 수단 없음" 상태를 만든다.
    __resetParserTransportsForTests();
    const out = await render("DOC-BODY", { path: "/ws/a.sec2" });
    expect(out).toContain("parser-blocked");
    expect(out).toContain('data-blocked-reason="no-transport"');
    // 사용자 코드 산출물이 절대 나오지 않는다 (in-process fallthrough 금지).
    expect(out).not.toContain("SBX:DOC-BODY");
  });

  it("sandbox 에러 시에도 in-process factory 로 강등하지 않는다", async () => {
    registerAndConsent("sec-throw", ".sec3", `() => { throw new Error("worker-side boom"); }`);
    const out = await render("DOC-BODY", { path: "/ws/a.sec3" });
    expect(out).toContain('data-blocked-reason="error"');
    expect(out).toContain("worker-side boom");
  });

  it("builtin markdown 은 기존 in-process 사이클 유지 (inv.builtin-parser-parity)", async () => {
    const out = await render("# Title", { path: "/ws/doc.md" });
    expect(out).toContain("<h1>Title</h1>");
  });
});

describe("SC-SEC-02 — Validator 위반 파서는 등록이 거부된다", () => {
  it("violating source never reaches the registry nor the renderer", async () => {
    const r = registerParserFromSource({
      id: "sec-viol",
      displayName: "V",
      extensions: [".sec4"],
      source: `(input) => { fetch("http://evil"); return { ast: { kind: "html", html: "X" } }; }`,
    });
    expect(r.ok).toBe(false);
    expect(r.violations.some((v) => v.code === "network_fetch")).toBe(true);
    expect(
      getParserRegistry()
        .list()
        .some((p) => p.manifest.id === "sec-viol"),
    ).toBe(false);
    // 렌더는 builtin fallback (매칭 파서 없음) — 차단이 아니라 애초에 미등록.
    const out = await render("plain", { path: "/ws/a.sec4" });
    expect(out).not.toContain("X");
  });
});

describe("SC-SEC-03 — BudgetGuard 100ms 로컬 예산 강제", () => {
  it("100ms 초과 파서는 suspend + 토스트 알림 + 차단 카드 (이후 렌더도 차단)", async () => {
    // 응답을 영원히 주지 않는 transport — busy-loop worker 와 동일한 관측 형태.
    setRuntimeParserTransportFactoryForTests((): SandboxTransport => {
      return {
        mode: "worker",
        postMessage: () => {},
        onMessage: () => () => {},
        dispose: () => {},
      };
    });
    registerAndConsent("sec-slow", ".sec5", OK_SOURCE);
    const t0 = performance.now();
    const out = await render("DOC", { path: "/ws/a.sec5" });
    const elapsed = performance.now() - t0;
    // BUDGETS.local.timeCapMs = 100 — 5000ms 기본 timeout 이 아니라 예산에서 끊긴다.
    expect(elapsed).toBeGreaterThanOrEqual(90);
    expect(elapsed).toBeLessThan(1000);
    expect(out).toContain('data-blocked-reason="suspended"');
    // 사용자 가시 알림 (기존 토스트 패턴).
    const toasts = useToasts.getState().toasts;
    expect(toasts.length).toBe(1);
    expect(toasts[0]?.kind).toBe("error");
    expect(toasts[0]?.message).toContain("sec-slow");
    expect(toasts[0]?.message).toContain("시간 초과");
    // suspend 기록 + transport 회수.
    expect(getRuntimeParserSuspension("sec-slow")).not.toBeNull();
    expect(getParserTransport("sec-slow")).toBeNull();
    // 후속 렌더는 dispatch 없이 즉시 차단 (토스트 중복 없음).
    const out2 = await render("DOC", { path: "/ws/a.sec5" });
    expect(out2).toContain('data-blocked-reason="suspended"');
    expect(useToasts.getState().toasts.length).toBe(1);
  });

  it("예산 안에서 끝나는 파서는 정상 렌더된다", async () => {
    registerAndConsent("sec-fast", ".sec6", OK_SOURCE);
    const out = await render("fast", { path: "/ws/a.sec6" });
    expect(out).toContain("SBX:fast");
    expect(useToasts.getState().toasts.length).toBe(0);
  });

  it("stale 타임아웃은 재등록된 새 세대 transport 를 suspend 하지 않는다 (race 가드)", async () => {
    // 1세대: 응답 없는 transport (워크벤치 debounce 중 교체되는 in-flight 렌더 모사).
    setRuntimeParserTransportFactoryForTests((): SandboxTransport => {
      return {
        mode: "worker",
        postMessage: () => {},
        onMessage: () => () => {},
        dispose: () => {},
      };
    });
    registerAndConsent("sec-race", ".sec10", OK_SOURCE);
    const stale = render("DOC", { path: "/ws/a.sec10" });
    // 타임아웃 전에 정상 transport 로 재등록 (2세대).
    setRuntimeParserTransportFactoryForTests(createInProcessParserTransportForTests);
    registerAndConsent("sec-race", ".sec10", OK_SOURCE);
    const staleOut = await stale;
    // stale 렌더 자체는 차단 카드지만, 새 세대는 살아있고 suspend/토스트 없음.
    expect(staleOut).toContain("parser-blocked");
    expect(getRuntimeParserSuspension("sec-race")).toBeNull();
    expect(useToasts.getState().toasts.length).toBe(0);
    const fresh = await render("DOC", { path: "/ws/a.sec10" });
    expect(fresh).toContain("SBX:DOC");
  });
});

describe("sandbox 프로토콜 결과 처리 — parse:ok 의 두 result kind", () => {
  // renderInSandbox 는 worker 가 `{ kind: "html" }` 를 직접 보낼 수도,
  // `{ kind: "ast" }` 를 보낼 수도 있다 (messages.ts ParseResponseSchema).
  // 기본 worker bootstrap 은 항상 ast 로 보내므로, html 직행/미인식 AST 분기는
  // 프로토콜을 그대로 말하는 fake transport 로 고정한다.
  function respondWith(result: { kind: "html"; html: string } | { kind: "ast"; ast: unknown }) {
    setRuntimeParserTransportFactoryForTests((): SandboxTransport => {
      let handler: ((raw: unknown) => void) | null = null;
      return {
        mode: "worker",
        postMessage: (msg) => {
          handler?.({ type: "parse:ok", requestId: msg.requestId, parserId: msg.parserId, result });
        },
        onMessage: (h) => {
          handler = h;
          return () => {
            handler = null;
          };
        },
        dispose: () => {},
      };
    });
  }

  it("kind:'html' 결과는 sanitize 를 거쳐 그대로 렌더된다 (render.ts 410-412)", async () => {
    respondWith({ kind: "html", html: "<p>DIRECT-HTML</p><script>window.x=1</script>" });
    registerAndConsent("sec-proto-html", ".sech", OK_SOURCE);
    const out = await render("DOC", { path: "/ws/a.sech" });
    // 본문은 통과, script 는 이중 sanitize(worker-host + render) 에서 제거.
    expect(out).toContain("<p>DIRECT-HTML</p>");
    expect(out).not.toContain("<script>");
    expect(out).not.toContain("parser-blocked");
  });

  it("미인식 AST kind 는 bad-ast 차단 카드를 렌더한다 (render.ts 414-417)", async () => {
    respondWith({ kind: "ast", ast: { kind: "mystery-kind" } });
    registerAndConsent("sec-proto-badast", ".secb", OK_SOURCE);
    const out = await render("DOC", { path: "/ws/a.secb" });
    expect(out).toContain("parser-blocked");
    expect(out).toContain('data-blocked-reason="bad-ast"');
  });
});

describe("SC-SEC-04 — 활성 동의 없이는 실행되지 않는다", () => {
  it("미동의 파서 렌더는 consent 차단 카드 (사용자 코드 미실행)", async () => {
    const r = registerParserFromSource({
      id: "sec-consent",
      displayName: "C",
      extensions: [".sec7"],
      source: OK_SOURCE,
    });
    expect(r.ok).toBe(true);
    expect(r.consent?.action).toBe("show");
    expect(r.activated).toBe(false);
    const out = await render("DOC", { path: "/ws/a.sec7" });
    expect(out).toContain('data-blocked-reason="consent"');
    expect(out).not.toContain("SBX:DOC");
  });

  it("Accept 후에는 sandbox 로 정상 렌더된다", async () => {
    registerParserFromSource({
      id: "sec-consent-ok",
      displayName: "C2",
      extensions: [".sec8"],
      source: OK_SOURCE,
    });
    resolveParserConsent("sec-consent-ok", "accept");
    const out = await render("DOC", { path: "/ws/a.sec8" });
    expect(out).toContain("SBX:DOC");
  });

  it("Reject 는 등록을 롤백해 builtin fallback 으로 돌아간다", async () => {
    registerParserFromSource({
      id: "sec-consent-rej",
      displayName: "C3",
      extensions: [".sec9"],
      source: OK_SOURCE,
    });
    resolveParserConsent("sec-consent-rej", "reject");
    const out = await render("# H", { path: "/ws/a.sec9" });
    expect(out).not.toContain("SBX:");
    expect(out).not.toContain("parser-blocked");
  });
});
