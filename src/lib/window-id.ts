import { invoke } from "@tauri-apps/api/core";

interface WindowInfo {
  label: string;
  is_primary: boolean;
}

let cached: WindowInfo | null = null;
let pending: Promise<WindowInfo> | null = null;

/**
 * Returns the running window's label. We cache the result so the persist
 * suffix stays stable across calls without forcing every store to await.
 *
 * Falls back to "main" when invoked outside Tauri (e.g. unit tests via vite).
 */
export async function getWindowInfo(): Promise<WindowInfo> {
  if (cached) return cached;
  if (!pending) {
    pending = invoke<WindowInfo>("window_info").catch(() => ({
      label: "main",
      is_primary: true,
    }));
  }
  cached = await pending;
  return cached;
}

/**
 * Synchronous best-effort label. Falls back to "main" until `getWindowInfo`
 * has resolved. Stores that need a stable persist key on first render call
 * `getWindowInfo` once at module load and rebuild themselves once it resolves.
 */
export function syncWindowLabel(): string {
  return cached?.label ?? "main";
}

export function persistKeyFor(base: string): string {
  const label = syncWindowLabel();
  return label === "main" ? base : `${base}.${label}`;
}
