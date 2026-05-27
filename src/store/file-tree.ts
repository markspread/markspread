// S-FT-001 / MAR-1014: per-split FileTree expansion state.
//
// Wave-3 U3 refactor: the store key is now a composite of
// `${windowLabel}:${splitId}:${workspaceId}` (D-File-Tree in ADR-0011).
// The same root workspace opened in two splits gets two independent
// expansion sets — VSCode-parity — without re-scanning the directory.
//
// Backwards compatibility: legacy callers (single-shell `EditorShell`,
// `SidebarPeek`) continue to call `isExpanded(workspace, path)` and
// friends; the store routes those through the default split key
// (`${windowLabel}:default:${workspaceIdFor(workspace)}`) so visual
// behaviour is unchanged on the single-tab single-split fast path.

import { create } from "zustand";
import { persist } from "zustand/middleware";
import { syncWindowLabel } from "../lib/window-id";
import { workspaceIdFor } from "./workspace-layout";

/** Default split slot for callers that don't yet thread a splitId. */
export const DEFAULT_SPLIT_ID = "default";

/**
 * Build the composite persistence key for a (window, split, workspace)
 * triple. Used both by the store and by tests that want to verify the
 * exact key shape under different window labels.
 */
export function fileTreeSplitKey(
  windowLabel: string,
  splitId: string,
  workspaceId: string,
): string {
  return `${windowLabel}:${splitId}:${workspaceId}`;
}

/**
 * Convenience for callers that hold a raw workspace path; resolves the
 * workspace hash and the current window label internally.
 */
export function splitKeyForWorkspace(
  workspace: string,
  splitId: string = DEFAULT_SPLIT_ID,
): string {
  return fileTreeSplitKey(syncWindowLabel(), splitId, workspaceIdFor(workspace));
}

interface FileTreeState {
  // composite split key → set of expanded directory paths.
  splits: Record<string, string[]>;
  // -- legacy per-workspace API (single-shell back-compat) ---------------
  isExpanded: (workspace: string, path: string) => boolean;
  toggle: (workspace: string, path: string) => void;
  setExpanded: (workspace: string, path: string, expanded: boolean) => void;
  // -- per-split API (MAR-1014) ------------------------------------------
  isExpandedFor: (splitKey: string, path: string) => boolean;
  toggleFor: (splitKey: string, path: string) => void;
  setExpandedFor: (splitKey: string, path: string, expanded: boolean) => void;
  /**
   * Migration entrypoint: copy an existing default-key expansion set
   * into a new split key (used when a split is first instantiated and
   * we want it to inherit the parent's expansion state).
   */
  seedSplit: (splitKey: string, source: readonly string[]) => void;
  /** Drop a split's expansion set (GC on split-remove). */
  removeSplit: (splitKey: string) => void;
  /**
   * Garbage-collect every split whose key is NOT in the supplied set.
   * Called by the workspace-layout sync hook after a split removal so
   * stale entries don't accumulate across windows.
   */
  retainSplits: (keep: ReadonlySet<string>) => void;
}

function defaultKeyFor(workspace: string): string {
  return splitKeyForWorkspace(workspace, DEFAULT_SPLIT_ID);
}

/**
 * Lift a legacy `expanded: Record<workspace, string[]>` persisted blob
 * into the new composite-key shape under the current window's default
 * split slot. Exported for unit testing — the store wires this through
 * zustand's `migrate` hook automatically.
 */
export function migrateLegacyFileTreeState(persisted: unknown): {
  splits: Record<string, string[]>;
} {
  if (!persisted || typeof persisted !== "object") return { splits: {} };
  const obj = persisted as Record<string, unknown>;
  if (obj.splits && typeof obj.splits === "object") {
    return { splits: obj.splits as Record<string, string[]> };
  }
  const legacy = (obj.expanded ?? {}) as Record<string, unknown>;
  const splits: Record<string, string[]> = {};
  const label = syncWindowLabel();
  for (const ws of Object.keys(legacy)) {
    const list = legacy[ws];
    if (!Array.isArray(list)) continue;
    const filtered = list.filter((p): p is string => typeof p === "string");
    if (filtered.length === 0) continue;
    const key = fileTreeSplitKey(label, DEFAULT_SPLIT_ID, workspaceIdFor(ws));
    splits[key] = filtered;
  }
  return { splits };
}

/**
 * S-FT-001: persisted expansion state per-split, per-window.
 *
 * Arrays (not Sets) for JSON friendliness; lookup is O(n) but n is
 * bounded by the user's expansion footprint, not the directory size.
 *
 * Persist `name` is `markspread.file-tree` (no window suffix at the
 * zustand layer — the window label is already baked into each split
 * key, so cross-window isolation is structural rather than namespaced).
 */
export const useFileTree = create<FileTreeState>()(
  persist(
    (set, get) => ({
      splits: {},
      isExpanded: (workspace, path) => {
        const key = defaultKeyFor(workspace);
        return get().isExpandedFor(key, path);
      },
      toggle: (workspace, path) => {
        const key = defaultKeyFor(workspace);
        get().toggleFor(key, path);
      },
      setExpanded: (workspace, path, expanded) => {
        const key = defaultKeyFor(workspace);
        get().setExpandedFor(key, path, expanded);
      },
      isExpandedFor: (splitKey, path) => {
        const list = get().splits[splitKey] ?? [];
        return list.includes(path);
      },
      toggleFor: (splitKey, path) => {
        const list = get().splits[splitKey] ?? [];
        const next = list.includes(path) ? list.filter((p) => p !== path) : [...list, path];
        set({ splits: { ...get().splits, [splitKey]: next } });
      },
      setExpandedFor: (splitKey, path, expanded) => {
        const list = get().splits[splitKey] ?? [];
        const has = list.includes(path);
        if (expanded === has) return;
        const next = expanded ? [...list, path] : list.filter((p) => p !== path);
        set({ splits: { ...get().splits, [splitKey]: next } });
      },
      seedSplit: (splitKey, source) => {
        if (get().splits[splitKey]) return;
        set({ splits: { ...get().splits, [splitKey]: [...source] } });
      },
      removeSplit: (splitKey) => {
        const current = get().splits;
        if (!(splitKey in current)) return;
        const { [splitKey]: _drop, ...rest } = current;
        void _drop;
        set({ splits: rest });
      },
      retainSplits: (keep) => {
        const current = get().splits;
        const next: Record<string, string[]> = {};
        let changed = false;
        for (const k of Object.keys(current)) {
          if (keep.has(k)) {
            const v = current[k];
            if (v) next[k] = v;
          } else {
            changed = true;
          }
        }
        if (changed) set({ splits: next });
      },
    }),
    {
      name: "markspread.file-tree",
      version: 1,
      // S-FT-001 migration: legacy schema stored `expanded: Record<workspace, string[]>`.
      // See `migrateLegacyFileTreeState` below for the lift logic. The
      // delegate is covered by `migrateLegacyFileTreeState` tests; the
      // zustand persist callback wrapper itself only forwards.
      /* v8 ignore next -- thin forwarder; migrateLegacyFileTreeState has dedicated tests */
      migrate: (persisted, _version) => migrateLegacyFileTreeState(persisted),
    },
  ),
);
