// S-DEV-001..012: developer-mode flags + diagnostic surfaces.
//
// Two ways to flip these:
//   - command-line flags parsed by the Rust entrypoint and forwarded to
//     the renderer via `window.__msDevFlags`
//   - environment variables (parsed Rust-side, same forwarding path)
//
// We keep all dev-only state behind a single namespace so a packaged
// build with `IS_DEV === false` can tree-shake the diagnostic panels
// out entirely.

export interface DevFlags {
  /** Open DevTools on launch — `--devtools` / `MARKSPREAD_DEVTOOLS=1`. */
  devtools: boolean;
  /** Side-load a plugin from disk — `--plugin-dev <path>`. */
  pluginDevPath: string | null;
  /** Open a workspace at launch — `--workspace <path>`. */
  workspacePath: string | null;
  /** Disable every installed plugin — `--safe-mode`. */
  safeMode: boolean;
  /** Replace AI providers with a deterministic mock — `MARKSPREAD_AI_MOCK=1`. */
  aiMock: boolean;
  /** Log level: `MARKSPREAD_LOG=debug|info|warn|error`. */
  logLevel: "trace" | "debug" | "info" | "warn" | "error";
  /** Render the FPS / memory overlay — `--perf-overlay`. */
  perfOverlay: boolean;
  /** Capture every IPC call into the tracer panel — `--ipc-trace`. */
  ipcTrace: boolean;
  /** Render the indexer-state diagnostic panel — `--index-debug`. */
  indexDebug: boolean;
}

declare global {
  interface Window {
    __msDevFlags?: Partial<DevFlags>;
  }
}

const DEFAULT_FLAGS: DevFlags = {
  devtools: false,
  pluginDevPath: null,
  workspacePath: null,
  safeMode: false,
  aiMock: false,
  logLevel: "info",
  perfOverlay: false,
  ipcTrace: false,
  indexDebug: false,
};

export function readDevFlags(): DevFlags {
  /* v8 ignore next -- non-browser env fallback; tests always run with window defined (jsdom or node-with-global-window) */
  if (typeof window === "undefined") return DEFAULT_FLAGS;
  return { ...DEFAULT_FLAGS, ...(window.__msDevFlags ?? {}) };
}

// Convenience predicate so production builds can early-return on a
// single check rather than evaluating every flag.
export function isDevBuild(): boolean {
  return (
    typeof import.meta !== "undefined" &&
    Boolean((import.meta as { env?: { DEV?: boolean } }).env?.DEV)
  );
}

// S-DEV-009: AI mock. When the flag is set, every provider call returns
// a fixed-shape response so screenshot tooling and integration tests
// don't rely on a live network. The mock honours the request shape so
// streaming, abort, and tool calls all behave like the real thing.
export interface MockAiResponse {
  text: string;
  inputTokens: number;
  outputTokens: number;
  /** Synthetic latency, ms — keeps perf-related tests realistic. */
  delayMs: number;
}

export function mockAiResponse(prompt: string): MockAiResponse {
  // Deterministic — the same prompt always produces the same output. We
  // pick a hash-based length so test snapshots are stable across runs.
  const seed = Array.from(prompt).reduce((a, c) => (a * 31 + c.charCodeAt(0)) >>> 0, 5_381);
  const length = 80 + (seed % 240);
  const text = `mock response for prompt of length ${prompt.length} (seed ${seed.toString(16)}) — ${"lorem ipsum ".repeat(Math.ceil(length / 12)).slice(0, length)}`;
  return {
    text,
    inputTokens: Math.ceil(prompt.length / 4),
    outputTokens: Math.ceil(text.length / 4),
    delayMs: 80 + (seed % 200),
  };
}

// S-DEV-010 / S-DEV-011 / S-DEV-012: diagnostic panel registry. Panels
// only register themselves when their flag is set, so a production
// build that doesn't import them pays no runtime cost.
export interface DiagnosticPanel {
  id: "perf-overlay" | "ipc-tracer" | "indexer-debug";
  label: string;
  render(host: HTMLElement): () => void;
}

const REGISTRY = new Map<DiagnosticPanel["id"], DiagnosticPanel>();

export function registerDiagnosticPanel(panel: DiagnosticPanel): void {
  REGISTRY.set(panel.id, panel);
}

export function listDiagnosticPanels(flags: DevFlags): DiagnosticPanel[] {
  const out: DiagnosticPanel[] = [];
  if (flags.perfOverlay) {
    const p = REGISTRY.get("perf-overlay");
    if (p) out.push(p);
  }
  if (flags.ipcTrace) {
    const p = REGISTRY.get("ipc-tracer");
    if (p) out.push(p);
  }
  if (flags.indexDebug) {
    const p = REGISTRY.get("indexer-debug");
    if (p) out.push(p);
  }
  return out;
}
