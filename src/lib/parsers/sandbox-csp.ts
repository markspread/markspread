// S-PSDK-003: parser sandbox 의 CSP 헤더 / iframe sandbox 속성 정의.
//
// 두 격리 모드 모두 외부 네트워크 호출을 차단하는 기본값을 강제한다. 파서가
// 외부 자원을 필요로 한다면 manifest 단계에서 명시적으로 허용 도메인을
// 받아야 하며 (v1.3 스코프), 본 단계에서는 모두 거부.

export type IsolationMode = "worker" | "iframe";

/**
 * Worker 격리 시 사용할 CSP 문자열. blob: URL 로 생성된 Worker 가
 * 자기 자신과 blob 만 로드하고, 어떤 fetch/connect/스크립트도 외부로
 * 나가지 못하도록 잠근다. import()/Worker 내부 import 도 차단된다.
 */
export const WORKER_CSP = [
  "default-src 'none'",
  "script-src 'self' blob:",
  "worker-src 'self' blob:",
  "connect-src 'none'",
  "img-src 'none'",
  "style-src 'none'",
  "font-src 'none'",
  "frame-src 'none'",
  "base-uri 'none'",
].join("; ");

/**
 * iframe 격리 시 sandbox 속성. allow-scripts 는 파서 실행을 위해 필수.
 * allow-same-origin / allow-top-navigation / allow-popups / allow-forms 는
 * 모두 빠져있어야 한다 — 그 누락이 곧 격리.
 */
export const IFRAME_SANDBOX = "allow-scripts";

/**
 * iframe 내부에 주입할 inline CSP meta. parent 가 srcdoc 으로 주입한
 * 문서가 자체 fetch 를 못 하게 한다.
 */
export const IFRAME_CSP_META = [
  "default-src 'none'",
  "script-src 'unsafe-inline' blob:",
  "style-src 'unsafe-inline'",
  "img-src data:",
  "connect-src 'none'",
  "base-uri 'none'",
].join("; ");

/**
 * CSP 문자열에 외부 호스트가 들어있는지 — 회귀 테스트용. 의도치 않게
 * `https://` 를 풀어버린 경우 즉시 잡힌다.
 */
export function cspAllowsExternalConnections(csp: string): boolean {
  return matchesDirective(csp, "connect-src");
}

export function cspAllowsScriptHosts(csp: string): boolean {
  return matchesDirective(csp, "script-src");
}

function matchesDirective(csp: string, directive: string): boolean {
  const re = new RegExp(`(?:^|;\\s*)${directive}\\b([^;]*)`, "i");
  const m = csp.match(re);
  if (!m) return false;
  const body = m[1] ?? "";
  return /(?:^|\s)(\*|https?:)/i.test(body);
}
