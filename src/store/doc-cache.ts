// S-ESP-005: shared per-workspace document cache.
//
// Two panes that open the same file should agree on the on-disk baseline —
// otherwise dirty-state, save races, and the "buffer share" promise in
// S-ESP-007 fall apart. EditorPane.tsx historically kept this state local, so
// each EditorPane instance fetched and tracked its own copy. With multi-pane
// (S-ESP-005) we hoist that into a zustand store keyed by `${workspace}::${path}`.
//
// What lives here:
//   - baseline content + encoding (used to compute "dirty")
//   - live content the user is currently typing (for save-on-debounce)
//   - last access error (so a retry can recover without remounting)
//   - reload epoch (bump to force a re-fetch)
//
// What does NOT live here:
//   - CodeMirror state — that belongs to each EditorView (per-pane).
//   - Pane / tab layout — that's editor-layout.

import { create } from "zustand";
import type { AccessDecision } from "../lib/access-policy/types";

export interface DocBaseline {
  content: string;
  encoding: string;
  mtime?: number | null;
  sha256?: string | null;
}

interface DocCacheState {
  baselines: Record<string, DocBaseline>;
  live: Record<string, string>;
  errors: Record<string, AccessDecision>;
  reloadEpoch: Record<string, number>;
  key: (workspace: string, path: string) => string;
  getBaseline: (workspace: string, path: string) => DocBaseline | undefined;
  setBaseline: (workspace: string, path: string, baseline: DocBaseline) => void;
  getLive: (workspace: string, path: string) => string | undefined;
  setLive: (workspace: string, path: string, content: string) => void;
  getError: (workspace: string, path: string) => AccessDecision | undefined;
  setError: (workspace: string, path: string, decision: AccessDecision) => void;
  clearError: (workspace: string, path: string) => void;
  bumpReload: (workspace: string, path: string) => number;
  forget: (workspace: string, path: string) => void;
}

function k(workspace: string, path: string): string {
  return `${workspace}::${path}`;
}

export const useDocCache = create<DocCacheState>()((set, get) => ({
  baselines: {},
  live: {},
  errors: {},
  reloadEpoch: {},
  key: k,
  getBaseline: (workspace, path) => get().baselines[k(workspace, path)],
  setBaseline: (workspace, path, baseline) => {
    const key = k(workspace, path);
    set({ baselines: { ...get().baselines, [key]: baseline } });
    // Seed live content on first load so dirty detection works immediately.
    if (get().live[key] === undefined) {
      set({ live: { ...get().live, [key]: baseline.content } });
    }
  },
  getLive: (workspace, path) => get().live[k(workspace, path)],
  setLive: (workspace, path, content) => {
    const key = k(workspace, path);
    if (get().live[key] === content) return;
    set({ live: { ...get().live, [key]: content } });
  },
  getError: (workspace, path) => get().errors[k(workspace, path)],
  setError: (workspace, path, decision) => {
    set({ errors: { ...get().errors, [k(workspace, path)]: decision } });
  },
  clearError: (workspace, path) => {
    const key = k(workspace, path);
    if (!(key in get().errors)) return;
    const next = { ...get().errors };
    delete next[key];
    set({ errors: next });
  },
  bumpReload: (workspace, path) => {
    const key = k(workspace, path);
    const next = (get().reloadEpoch[key] ?? 0) + 1;
    set({ reloadEpoch: { ...get().reloadEpoch, [key]: next } });
    return next;
  },
  forget: (workspace, path) => {
    const key = k(workspace, path);
    const { baselines, live, errors, reloadEpoch } = get();
    const nextB = { ...baselines };
    const nextL = { ...live };
    const nextE = { ...errors };
    const nextR = { ...reloadEpoch };
    delete nextB[key];
    delete nextL[key];
    delete nextE[key];
    delete nextR[key];
    set({ baselines: nextB, live: nextL, errors: nextE, reloadEpoch: nextR });
  },
}));

/**
 * S-ESP-007: per-path save coalescer. Two panes editing the same file each
 * call `scheduleSave` on every keystroke; without coalescing, both would fire
 * their own debounced save → two writes to disk for the same content.
 *
 * The map is module-local rather than store state because timers aren't
 * structural data — we never need to render them, persist them, or diff them.
 * Idempotent by (workspace,path): a later schedule clears the previous timer.
 */
const saveTimers = new Map<string, ReturnType<typeof setTimeout>>();

export function scheduleSave(
  workspace: string,
  path: string,
  delayMs: number,
  flusher: () => Promise<void> | void,
): void {
  const key = `${workspace}::${path}`;
  const existing = saveTimers.get(key);
  if (existing) clearTimeout(existing);
  const timer = setTimeout(() => {
    saveTimers.delete(key);
    void flusher();
  }, delayMs);
  saveTimers.set(key, timer);
}

export function cancelScheduledSave(workspace: string, path: string): void {
  const key = `${workspace}::${path}`;
  const existing = saveTimers.get(key);
  if (existing) {
    clearTimeout(existing);
    saveTimers.delete(key);
  }
}

/** Test-only: drop every pending save timer. */
export function _resetSaveTimers(): void {
  for (const timer of saveTimers.values()) clearTimeout(timer);
  saveTimers.clear();
}

/** Did the user type anything different from the on-disk baseline? */
export function isDirty(workspace: string, path: string): boolean {
  const s = useDocCache.getState();
  const baseline = s.getBaseline(workspace, path);
  if (baseline === undefined) return false;
  const live = s.getLive(workspace, path);
  if (live === undefined) return false;
  return live !== baseline.content;
}
