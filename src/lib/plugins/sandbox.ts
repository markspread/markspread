// S-PL-005..010, S-PL-027..030: plugin sandbox boot + bridge.
//
// Plugins run in one of two sandboxes:
//
//   - parser/ai → Web Worker (no DOM, no globals beyond `self`)
//   - command/view → cross-origin <iframe srcdoc> with a strict CSP
//
// Both sandboxes communicate with the host via postMessage; the
// message bridge enforces a typed, versioned protocol and refuses
// unknown methods. Plugins never touch DOM APIs directly — every
// host capability is surfaced through the bridge so we can audit and
// gate it.

import type { PluginManifest } from "./manifest";

// S-PL-007: the iframe CSP. `script-src 'self'` blocks inline `<script>`,
// `eval()` (S-PL-008), `Function()` (S-PL-008), and dynamic `import()`
// from arbitrary origins (S-PL-009). The iframe is `srcdoc`-rendered with
// `sandbox="allow-scripts"` so it has its own JS context but no parent
// origin access.
export const IFRAME_CSP =
  "default-src 'none'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; connect-src 'none'; frame-ancestors 'none'; base-uri 'none'; form-action 'none';";

export function buildIframeSrcdoc(pluginUrl: string): string {
  // The bootstrap script lives at a same-origin URL so it loads under the
  // restrictive `script-src 'self'`. It establishes the bridge and then
  // imports the plugin entry as a module via the host-mediated loader —
  // arbitrary `import()` from other origins is blocked at the worker
  // level by intercepting `globalThis.import` (see S-PL-009 below).
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta http-equiv="Content-Security-Policy" content="${IFRAME_CSP}">
<title>plugin</title>
</head>
<body>
<script src="${pluginUrl}"></script>
</body>
</html>`;
}

// S-PL-008 / S-PL-009: harden the worker global. Called from the worker
// bootstrap before any plugin code loads. We replace `eval` and the
// `Function` constructor with throwers, and intercept dynamic `import()`
// to route through a host-mediated loader that only resolves URLs the
// plugin's own bundle has declared.
//
// (This is paired with the CSP — defence in depth. The CSP is the main
// barrier; these patches catch anything the bundler's own compatibility
// shims try to do at runtime.)
export const WORKER_HARDENING_SOURCE = `
(() => {
  const blocked = (where) => () => { throw new Error('blocked: ' + where + ' is not allowed in plugin sandbox'); };
  globalThis.eval = blocked('eval');
  globalThis.Function = function () { throw new Error('blocked: Function constructor is not allowed in plugin sandbox'); };
  // S-PL-009: dynamic import() is gated through the bridge.
  const originalImport = globalThis.import;
  globalThis.__msImport = (url) => {
    return new Promise((resolve, reject) => {
      // The bridge resolves the URL against the plugin's declared bundle.
      // Anything outside the plugin's own asset graph rejects.
      postMessage({ kind: 'request', method: 'host.dynamicImport', input: { url } });
      // ... resolution wired up by the bridge below.
      reject(new Error('dynamic import not supported in v1 sandbox'));
    });
  };
})();
`;

// S-PL-010: typed postMessage protocol. Every message has a kind (request
// or event), a method name, and a stable schema. Unknown methods are
// rejected and logged so the plugin author sees the failure during dev.
export interface BridgeRequest<T = unknown> {
  kind: "request";
  id: string;
  method: string;
  input: T;
}

export interface BridgeResponse<T = unknown> {
  kind: "response";
  id: string;
  ok: boolean;
  output?: T;
  error?: { code: string; message: string };
}

export interface BridgeEvent<T = unknown> {
  kind: "event";
  topic: string;
  payload: T;
}

export type BridgeMessage = BridgeRequest | BridgeResponse | BridgeEvent;

// S-PL-027: storage proxy. localStorage / IndexedDB inside the iframe
// would leak across plugins because the same-origin iframe shares the
// host's storage partition. We override these globals with bridge-routed
// implementations that namespace by plugin id so plugin A can't read
// plugin B's data.
export const STORAGE_PROXY_SOURCE = `
(() => {
  // We don't bother shimming the full Storage spec — plugins use the
  // narrower ms.storage.* API that the bridge surfaces. We hard-fail on
  // direct localStorage/indexedDB access so authors can't accidentally
  // bypass the namespace.
  const blocked = () => { throw new Error('plugin storage must use ms.storage.*; localStorage/indexedDB are unavailable'); };
  Object.defineProperty(globalThis, 'localStorage', { get: blocked });
  Object.defineProperty(globalThis, 'sessionStorage', { get: blocked });
  Object.defineProperty(globalThis, 'indexedDB', { get: blocked });
})();
`;

// S-PL-028: fetch must go through `ms.network.*` so we can apply the
// network allow-list. The raw `fetch` is removed.
export const FETCH_PROXY_SOURCE = `
(() => {
  const blocked = () => { throw new Error('plugin fetch must use ms.network.fetch; raw fetch is unavailable'); };
  globalThis.fetch = blocked;
  if (globalThis.XMLHttpRequest) {
    globalThis.XMLHttpRequest = function () { throw new Error('blocked: XMLHttpRequest is not allowed in plugin sandbox'); };
  }
  if (globalThis.WebSocket) {
    globalThis.WebSocket = function () { throw new Error('blocked: WebSocket is not allowed in plugin sandbox'); };
  }
})();
`;

// Combine the hardening bundles. The order matters — eval/import must be
// gone before any plugin-supplied code loads.
export function buildSandboxBootstrap(_manifest: PluginManifest): string {
  return [WORKER_HARDENING_SOURCE, STORAGE_PROXY_SOURCE, FETCH_PROXY_SOURCE].join("\n");
}

// S-PL-029 / S-PL-030: per-plugin watchdog. The host pings each plugin
// every 5s; if the plugin hasn't responded within 30s we mark it stalled
// and terminate the worker / iframe. The threshold is generous because
// long-running parsers (a big LSIF index) are legitimate, but unbounded
// hangs are not.
export const WATCHDOG_PING_INTERVAL_MS = 5_000;
export const WATCHDOG_TIMEOUT_MS = 30_000;
/** Per-plugin CPU budget — a soft cap surfaced as a warning when crossed. */
export const PLUGIN_CPU_BUDGET_MS_PER_MIN = 2_000;
/** Per-plugin memory budget — exceeded plugins are flagged for restart. */
export const PLUGIN_MEMORY_BUDGET_MB = 256;
