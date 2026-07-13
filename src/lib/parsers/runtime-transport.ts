// SC-SEC-01 / ADR-0012 D1 + ADR-0016: 런타임(신뢰경계 밖) 파서의 Worker 격리 transport.
//
// register-from-source 로 들어오는 llm-generated 파서 소스는 *메인스레드에서
// 절대 실행하지 않는다*. 소스를 worker bootstrap 스크립트에 심어 blob Worker
// 로 띄우고, transport-registry 에 등록해 preview/render.ts 의 renderInSandbox
// 경로가 사용한다. Worker 안에서는 DOM / window / __TAURI__ 에 도달할 수 없다
// (ADR-0012 Options A.(b)).
//
// 환경에 Worker 가 없으면(fail-closed) 모든 parse 요청에 parse:err 로 응답하는
// transport 를 반환한다 — "격리 불가 → in-process 로 강등" 이 바로 R1 의
// SC-SEC-01 결함 클래스이므로, 강등 대신 차단한다.

import { type SandboxTransport, createWorkerTransport } from "./renderer-host";
import { registerParserTransport, unregisterParserTransport } from "./transport-registry";

/**
 * `export default` / `module.exports =` 표기를 벗겨 factory expression 만 남긴다.
 * 워커 스크립트와 in-process evaluate(evaluateFactory — local trust 전용)가
 * 같은 규칙을 공유해야 두 경로의 evaluate 규칙이 갈라지지 않는다.
 */
export function stripFactorySource(source: string): string {
  return source
    .replace(/^\s*export\s+default\s+/m, "")
    .replace(/^\s*module\.exports\s*=\s*/m, "")
    .trim();
}

/**
 * 파서 factory 소스를 Worker 안에서 평가·실행하는 bootstrap 스크립트.
 * 메시지 계약은 messages.ts 의 ParseRequest/ParseResponse/ParseError 그대로:
 *   - 결과는 항상 `{ kind: "ast", ast }` 로 보낸다. host(render.ts) 가
 *     handleInProcessAst 로 html sanitize / markdown 재파이프라인 / raw escape
 *     를 수행한다 (builtin 과 동일한 factory→AST→render 사이클).
 *   - factory 평가 실패(문법 외 shape 오류 포함)는 각 요청에 parse:err.
 */
export function buildParserWorkerScript(source: string): string {
  const stripped = stripFactorySource(source);
  return [
    '"use strict";',
    "let __factory = null;",
    "let __evalError = null;",
    "try {",
    "  __factory = (function () { return (",
    stripped,
    "  ); })();",
    '  if (typeof __factory !== "function") {',
    '    __evalError = "factory must be a function, got " + typeof __factory;',
    "    __factory = null;",
    "  }",
    "} catch (e) {",
    "  __evalError = e instanceof Error ? e.message : String(e);",
    "}",
    "self.onmessage = function (ev) {",
    "  const msg = ev && ev.data;",
    '  if (!msg || msg.type !== "parse") return;',
    "  if (!__factory) {",
    '    self.postMessage({ type: "parse:err", requestId: msg.requestId, parserId: msg.parserId, message: __evalError || "factory unavailable" });',
    "    return;",
    "  }",
    "  try {",
    "    const out = __factory({ path: msg.path, content: msg.content, encoding: msg.encoding });",
    '    const ast = out && typeof out === "object" && "ast" in out ? out.ast : { kind: "raw", value: out };',
    '    self.postMessage({ type: "parse:ok", requestId: msg.requestId, parserId: msg.parserId, result: { kind: "ast", ast: ast } });',
    "  } catch (e) {",
    '    self.postMessage({ type: "parse:err", requestId: msg.requestId, parserId: msg.parserId, message: e instanceof Error ? e.message : String(e) });',
    "  }",
    "};",
  ].join("\n");
}

export type RuntimeParserTransportFactory = (parserId: string, source: string) => SandboxTransport;

/**
 * Worker 가 없는 환경(fail-closed)용 transport — 모든 요청을 parse:err 로 응답.
 * render.ts 는 이 에러를 받아 차단 카드를 렌더한다 (in-process 강등 금지).
 */
function createFailClosedTransport(parserId: string): SandboxTransport {
  let handler: ((raw: unknown) => void) | null = null;
  return {
    mode: "worker",
    onMessage: (h) => {
      handler = h;
      return () => {
        handler = null;
      };
    },
    postMessage: (msg) => {
      queueMicrotask(() =>
        handler?.({
          type: "parse:err",
          requestId: msg.requestId,
          parserId,
          message: "worker isolation unavailable in this environment — parser execution blocked",
        }),
      );
    },
    dispose: () => {
      handler = null;
    },
  };
}

function defaultTransportFactory(parserId: string, source: string): SandboxTransport {
  if (typeof Worker === "undefined" || typeof URL.createObjectURL !== "function") {
    return createFailClosedTransport(parserId);
  }
  const blobUrl = URL.createObjectURL(
    new Blob([buildParserWorkerScript(source)], { type: "text/javascript" }),
  );
  const inner = createWorkerTransport(blobUrl);
  return {
    mode: inner.mode,
    postMessage: (msg) => inner.postMessage(msg),
    onMessage: (h) => inner.onMessage(h),
    dispose: () => {
      inner.dispose();
      URL.revokeObjectURL(blobUrl);
    },
  };
}

let transportFactory: RuntimeParserTransportFactory = defaultTransportFactory;

/**
 * 테스트 시임 — jsdom 에는 Worker 가 없어 기본값은 fail-closed 다. 실제 렌더
 * 동작을 검증하는 스위트는 in-process 에뮬레이션 factory 를 주입한다.
 * 프로덕션 코드는 이 함수를 절대 호출하지 않는다 (wiring 테스트가 고정).
 */
export function setRuntimeParserTransportFactoryForTests(
  factory: RuntimeParserTransportFactory | null,
): void {
  transportFactory = factory ?? defaultTransportFactory;
}

// BudgetGuard suspend(ADR-0016 T5.D) 상태 — suspend 된 파서는 재등록 전까지
// transport 없이 차단 상태로 유지된다.
const suspensions = new Map<string, string>();

/**
 * 파서를 격리 transport 와 함께 활성화. 기존 transport 는 transport-registry
 * 가 dispose 하고 교체한다. suspend 상태는 재활성으로 해제.
 */
export function activateRuntimeParser(parserId: string, source: string): void {
  suspensions.delete(parserId);
  registerParserTransport(parserId, transportFactory(parserId, source));
}

/**
 * BudgetGuard 위반 등으로 파서를 suspend — worker 종료(dispose) + 사유 기록.
 */
export function suspendRuntimeParser(parserId: string, reason: string): void {
  suspensions.set(parserId, reason);
  unregisterParserTransport(parserId);
}

export function getRuntimeParserSuspension(parserId: string): string | null {
  return suspensions.get(parserId) ?? null;
}

/** 파서 제거 시 transport + suspend 상태 정리. */
export function disposeRuntimeParser(parserId: string): void {
  suspensions.delete(parserId);
  unregisterParserTransport(parserId);
}

/**
 * 테스트 전용 — buildParserWorkerScript 산출물을 *현재 프로세스에서* 실행해
 * Worker 를 에뮬레이션하는 transport. 실제 worker bootstrap 로직(스크립트
 * 자체)을 그대로 검증하기 위한 고충실도 fake. 신뢰경계가 없는 테스트
 * 환경에서만 사용한다 — 프로덕션 코드에서 호출 금지.
 */
export function createInProcessParserTransportForTests(
  _parserId: string,
  source: string,
): SandboxTransport {
  let handler: ((raw: unknown) => void) | null = null;
  const fakeSelf: {
    onmessage: ((ev: { data: unknown }) => void) | null;
    postMessage: (data: unknown) => void;
  } = {
    onmessage: null,
    postMessage: (data) => queueMicrotask(() => handler?.(data)),
  };
  // eslint-disable-next-line @typescript-eslint/no-implied-eval
  new Function("self", buildParserWorkerScript(source))(fakeSelf);
  return {
    mode: "worker",
    onMessage: (h) => {
      handler = h;
      return () => {
        handler = null;
      };
    },
    postMessage: (msg) => fakeSelf.onmessage?.({ data: msg }),
    dispose: () => {
      handler = null;
    },
  };
}

/** 테스트 전용 reset — factory + suspend 상태 초기화. */
export function __resetRuntimeParserTransportsForTests(): void {
  transportFactory = defaultTransportFactory;
  suspensions.clear();
}
