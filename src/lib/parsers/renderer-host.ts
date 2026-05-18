// S-PSDK-003: parser 격리 실행을 담당하는 host. 두 격리 모드를 지원한다.
//
//   - worker: blob: URL 로 생성한 Web Worker. 파서가 ESM 코드 한 덩어리이고
//             DOM 이 필요없을 때.
//   - iframe: srcdoc sandboxed iframe. 파서가 DOM(예: 임시 SVG 측정) 을
//             필요로 할 때.
//
// 두 경우 모두 postMessage 만이 host 와의 통로이며, 인입 메시지는
// `validateIncomingMessage` 로 zod 스키마 통과해야 한다. 검증 통과한 HTML
// 결과는 다시 `sanitiseMarkdownHtml` 로 한 번 더 통과시켜 XSS 페이로드를
// 최종 차단한다.

import {
  DEFAULT_SANITISE_OPTIONS,
  sanitiseMarkdownHtml,
  type SanitiseOptions,
} from "../security/markdown-sanitize";
import {
  validateIncomingMessage,
  type ParseRequest,
  type ParseResponse,
} from "./messages";
import { IFRAME_SANDBOX, WORKER_CSP, type IsolationMode } from "./sandbox-csp";

export type RenderedResult =
  | { kind: "html"; html: string; warnings: string[] }
  | { kind: "ast"; ast: unknown; warnings: string[] };

export type RenderError = {
  kind: "error";
  message: string;
  // raw payload 가 스키마에서 떨어진 경우 reason 노출 (감사용).
  rejectedReason?: string;
};

export type SandboxTransport = {
  postMessage: (msg: ParseRequest) => void;
  // host 가 등록한 콜백을 한 번 호출하고 자동 cleanup.
  onMessage: (handler: (raw: unknown) => void) => () => void;
  dispose: () => void;
  readonly mode: IsolationMode;
};

export type RendererHostOptions = {
  sanitise?: SanitiseOptions;
  /** request 응답이 늦으면 강제 종료 (ms). */
  timeoutMs?: number;
};

/**
 * 한 번의 parse 요청을 sandbox 로 보내고 검증된 결과를 반환한다.
 * 테스트는 `transport` 를 직접 주입하여 worker/iframe 인스턴스화 없이
 * 호스트 로직만 검증한다.
 */
export function renderInSandbox(
  transport: SandboxTransport,
  request: ParseRequest,
  opts: RendererHostOptions = {},
): Promise<RenderedResult | RenderError> {
  const timeoutMs = opts.timeoutMs ?? 5000;
  const sanitiseOpts = opts.sanitise ?? DEFAULT_SANITISE_OPTIONS;
  return new Promise((resolve) => {
    let settled = false;
    const cleanup = transport.onMessage((raw) => {
      if (settled) return;
      const v = validateIncomingMessage(raw);
      if (!v.ok) {
        settled = true;
        cleanup();
        resolve({
          kind: "error",
          message: "rejected by message schema",
          rejectedReason: v.reason,
        });
        return;
      }
      const msg = v.value;
      if (msg.type === "parse:err" && msg.requestId === request.requestId) {
        settled = true;
        cleanup();
        resolve({ kind: "error", message: msg.message });
        return;
      }
      if (msg.type === "parse:ok" && msg.requestId === request.requestId) {
        settled = true;
        cleanup();
        const out = (msg as ParseResponse).result;
        const warnings = msg.warnings ?? [];
        if (out.kind === "html") {
          resolve({
            kind: "html",
            html: sanitiseMarkdownHtml(out.html, sanitiseOpts),
            warnings,
          });
        } else {
          resolve({ kind: "ast", ast: out.ast, warnings });
        }
      }
    });
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      cleanup();
      resolve({
        kind: "error",
        message: `parser timed out after ${timeoutMs}ms`,
      });
    }, timeoutMs);
    // settle 시 timer 정리는 cleanup 함수에서 별도로 하지 않고 settled 가드로 무력화.
    void timer;
    transport.postMessage(request);
  });
}

// Worker 생성 헬퍼. 실제 런타임에서만 호출된다 (jsdom 환경에서는 Worker 가 없어
// 호출 자체가 생략되므로 테스트에서는 fake transport 를 주입한다).
export function createWorkerTransport(parserCodeBlobUrl: string): SandboxTransport {
  const worker = new Worker(parserCodeBlobUrl, { type: "module" });
  let handler: ((raw: unknown) => void) | null = null;
  worker.addEventListener("message", (ev) => handler?.(ev.data));
  return {
    mode: "worker",
    postMessage: (msg) => worker.postMessage(msg),
    onMessage: (h) => {
      handler = h;
      return () => {
        handler = null;
      };
    },
    dispose: () => worker.terminate(),
  };
}

// iframe 격리 헬퍼. srcdoc 에 CSP meta 를 inline 으로 박는다.
export function buildIframeSrcdoc(parserScript: string, cspMeta: string): string {
  return `<!doctype html><html><head><meta http-equiv="Content-Security-Policy" content="${cspMeta}"></head><body><script type="module">${parserScript}</script></body></html>`;
}

export { IFRAME_SANDBOX, WORKER_CSP };
