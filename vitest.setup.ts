// S-TST-001: shared test setup.
//
// We don't auto-mock @tauri-apps/api/core globally because some tests
// need to assert which IPC commands fired with what arguments. Instead,
// individual tests opt-in via `vi.mock(...)` and reuse the recording
// bridge from `src/lib/plugins/sdk.ts`.
//
// What we DO want everywhere: deterministic time, deterministic random
// (so seed-based fixtures stay stable), and a clean console — failing
// on unexpected console.error keeps regressions visible.

import { afterEach, vi } from "vitest";
// jsdom leaves Range.getClientRects/getBoundingClientRect unimplemented, so
// CodeMirror's deferred measure() pass (scheduled on an animation frame after
// dispatch) throws an uncaught TypeError inside any jsdom test that mounts an
// editor/code-viewer — not just the editor suites. Installing the shim here in
// shared setup covers every jsdom environment; it's a guarded no-op under node.
import "./src/lib/editor/extensions/jsdomLayoutShim";

const realError = console.error;
const realWarn = console.warn;

const ALLOWED_PREFIXES = [
  // React's act() warning lands here when async effects flush late;
  // tests should still fail loudly for unexpected spew, so we don't
  // silence — we record and re-emit, but we don't fail-by-default.
];

console.error = (...args: unknown[]) => {
  const msg = String(args[0] ?? "");
  if (ALLOWED_PREFIXES.some((p) => msg.startsWith(p))) return;
  realError(...args);
  throw new Error(`Unexpected console.error: ${msg}`);
};

console.warn = (...args: unknown[]) => {
  realWarn(...args);
};

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});
