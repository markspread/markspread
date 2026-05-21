import { create } from "zustand";
import { persist } from "zustand/middleware";
import { persistKeyFor } from "../lib/window-id";

export interface EditorPosition {
  line: number;
  column: number;
  scrollTop: number;
}

export interface OpenTab {
  path: string;
  position: EditorPosition;
  modifiedMs?: number;
  dirty?: boolean;
  /**
   * S-FT-004: a preview tab is a single, re-usable slot — opening another
   * preview replaces it. Pinned tabs are sticky.
   */
  preview?: boolean;
  /**
   * S-ESP-002: explicit "sticky" flag, independent of preview. VSCode
   * semantics — pinned tabs sort to the left of the bar and survive
   * "close all others". `pin()` sets this true and clears `preview`.
   */
  pinned?: boolean;
  /**
   * S-FT-018: external watcher reported the file gone but the tab is kept
   * open so the user's in-memory edits survive. Cleared on save-as-recreate
   * or when the user closes the tab.
   */
  orphaned?: boolean;
}

interface TabsState {
  tabs: OpenTab[];
  activePath: string | null;
  open: (path: string, opts?: { preview?: boolean }) => void;
  close: (path: string) => void;
  setActive: (path: string) => void;
  setPosition: (path: string, position: EditorPosition) => void;
  setDirty: (path: string, dirty: boolean) => void;
  pin: (path: string) => void;
  /** Unset the pinned flag without touching preview state. */
  unpin: (path: string) => void;
  /**
   * S-ESP-002: move a tab to a new index. Pinned-first ordering is
   * preserved by clamping the target into the same group as the
   * source — drag-into-the-other-group is treated as drop-at-edge.
   */
  reorder: (fromPath: string, toPath: string, before: boolean) => void;
  /**
   * S-FT-007: rebind tabs after a rename. Handles both file renames (exact
   * match) and directory renames (prefix match) so descendant tabs survive
   * a folder rename. Dirty state is preserved so unsaved edits aren't lost.
   */
  rename: (oldPath: string, newPath: string) => void;
  /**
   * S-FT-018: mark or unmark a path-rooted set of tabs as orphaned. Folder
   * deletes mark every descendant tab; recreating clears just one path.
   */
  setOrphaned: (path: string, orphaned: boolean) => void;
  replaceAll: (tabs: OpenTab[], activePath: string | null) => void;
}

export const useTabs = create<TabsState>()(
  persist(
    (set, get) => ({
      tabs: [],
      activePath: null,
      open: (path, opts) => {
        const preview = opts?.preview ?? false;
        const existing = get().tabs.find((t) => t.path === path);
        if (existing) {
          // Re-opening an orphaned path means the user (or another process)
          // re-created it; surface that by clearing the orphan flag now.
          const clearOrphan = !!existing.orphaned;
          // Promote preview → pinned when re-opened pinned.
          if ((existing.preview && !preview) || clearOrphan) {
            set({
              tabs: get().tabs.map((t) =>
                t.path === path
                  ? {
                      ...t,
                      preview: preview ? (t.preview ?? false) : false,
                      orphaned: false,
                    }
                  : t,
              ),
              activePath: path,
            });
          } else {
            set({ activePath: path });
          }
          return;
        }
        const tab: OpenTab = {
          path,
          position: { line: 1, column: 1, scrollTop: 0 },
          preview,
        };
        // Replace any existing preview tab — only one preview slot at a time.
        const existingTabs = preview ? get().tabs.filter((t) => !t.preview) : get().tabs;
        set({ tabs: [...existingTabs, tab], activePath: path });
      },
      close: (path) => {
        const tabs = get().tabs.filter((t) => t.path !== path);
        const active = get().activePath;
        const nextActive = active === path ? (tabs[tabs.length - 1]?.path ?? null) : active;
        set({ tabs, activePath: nextActive });
      },
      setActive: (path) => set({ activePath: path }),
      setPosition: (path, position) =>
        set({
          tabs: get().tabs.map((t) => (t.path === path ? { ...t, position } : t)),
        }),
      setDirty: (path, dirty) =>
        set({
          tabs: get().tabs.map((t) => (t.path === path ? { ...t, dirty } : t)),
        }),
      pin: (path) =>
        set({
          tabs: get().tabs.map((t) =>
            t.path === path ? { ...t, preview: false, pinned: true } : t,
          ),
        }),
      unpin: (path) =>
        set({
          tabs: get().tabs.map((t) => (t.path === path ? { ...t, pinned: false } : t)),
        }),
      reorder: (fromPath, toPath, before) => {
        const tabs = get().tabs.slice();
        const fromIdx = tabs.findIndex((t) => t.path === fromPath);
        const toIdx = tabs.findIndex((t) => t.path === toPath);
        if (fromIdx < 0 || toIdx < 0 || fromIdx === toIdx) return;
        const fromPinned = !!tabs[fromIdx]?.pinned;
        const toPinned = !!tabs[toIdx]?.pinned;
        // Drag across pinned/unpinned boundary → flip the dragged tab's
        // pinned flag to match the drop zone. Pin status follows the
        // group the user dropped into. Surprising? Slightly. But the
        // alternative — silently clamping to the boundary — leaves the
        // tab "stuck" against the divider, which surveys consistently
        // rate worse.
        const adjusted =
          fromPinned !== toPinned
            ? tabs.map((t, i) => (i === fromIdx ? { ...t, pinned: toPinned } : t))
            : tabs;
        const [moved] = adjusted.splice(fromIdx, 1);
        /* v8 ignore next -- fromIdx was validated as a tabs.findIndex result above (>= 0), so adjusted.splice(fromIdx, 1) always returns the moved element; the falsy guard is TS-defensive against array drift */
        if (!moved) return;
        const insertAt =
          fromIdx < toIdx ? (before ? toIdx - 1 : toIdx) : before ? toIdx : toIdx + 1;
        adjusted.splice(insertAt, 0, moved);
        set({ tabs: adjusted });
      },
      rename: (oldPath, newPath) => {
        const remap = (p: string) => {
          if (p === oldPath) return newPath;
          if (p.startsWith(`${oldPath}/`) || p.startsWith(`${oldPath}\\`)) {
            return newPath + p.slice(oldPath.length);
          }
          return p;
        };
        set({
          tabs: get().tabs.map((t) => {
            const next = remap(t.path);
            return next === t.path ? t : { ...t, path: next, orphaned: false };
          }),
          activePath: get().activePath ? remap(get().activePath as string) : null,
        });
      },
      setOrphaned: (path, orphaned) => {
        set({
          tabs: get().tabs.map((t) => {
            if (
              t.path === path ||
              t.path.startsWith(`${path}/`) ||
              t.path.startsWith(`${path}\\`)
            ) {
              return { ...t, orphaned };
            }
            return t;
          }),
        });
      },
      replaceAll: (tabs, activePath) => set({ tabs, activePath }),
    }),
    { name: persistKeyFor("markspread.tabs") },
  ),
);
