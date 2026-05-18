import { create } from "zustand";
import { persist } from "zustand/middleware";
import { persistKeyFor } from "../lib/window-id";

interface FileTreeState {
  // workspace path → set of expanded directory paths
  expanded: Record<string, string[]>;
  isExpanded: (workspace: string, path: string) => boolean;
  toggle: (workspace: string, path: string) => void;
  setExpanded: (workspace: string, path: string, expanded: boolean) => void;
}

/**
 * S-FT-001: persisted expansion state per-workspace, per-window. Stored as
 * arrays (not Sets) for JSON friendliness; lookup is O(n) but n is bounded
 * by the user's expansion footprint, not the directory size.
 */
export const useFileTree = create<FileTreeState>()(
  persist(
    (set, get) => ({
      expanded: {},
      isExpanded: (workspace, path) => {
        const list = get().expanded[workspace] ?? [];
        return list.includes(path);
      },
      toggle: (workspace, path) => {
        const list = get().expanded[workspace] ?? [];
        const next = list.includes(path) ? list.filter((p) => p !== path) : [...list, path];
        set({ expanded: { ...get().expanded, [workspace]: next } });
      },
      setExpanded: (workspace, path, expanded) => {
        const list = get().expanded[workspace] ?? [];
        const has = list.includes(path);
        if (expanded === has) return;
        const next = expanded ? [...list, path] : list.filter((p) => p !== path);
        set({ expanded: { ...get().expanded, [workspace]: next } });
      },
    }),
    { name: persistKeyFor("markspread.file-tree") },
  ),
);
