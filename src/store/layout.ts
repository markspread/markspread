import { create } from "zustand";
import { persist } from "zustand/middleware";
import { persistKeyFor } from "../lib/window-id";

export const SIDEBAR_MIN_PX = 200;
export const SIDEBAR_MAX_PX = 600;
export const SIDEBAR_DEFAULT_PX = 256;
// S-SBC-003: width of the slim rail shown when the sidebar is collapsed in
// "rail" mode. Wide enough to be a comfortable hover/click target without
// looking like real content. Used by Main.tsx and consumed by F2's peek
// trigger area.
export const SIDEBAR_RAIL_PX = 6;

export type SidebarCollapsedMode = "rail" | "hidden";
export const SIDEBAR_COLLAPSED_MODES: SidebarCollapsedMode[] = ["rail", "hidden"];

export type SortMode = "name" | "modified" | "type";
export const SORT_MODES: SortMode[] = ["name", "modified", "type"];
// English fallbacks. The FileTree resolves these through i18next at render
// time (`filetree.sort.<mode>`) so the visible text follows the active locale;
// keeping the constants here lets non-React consumers (e.g. tests) read a
// stable label without booting i18next.
export const SORT_LABEL: Record<SortMode, string> = {
  name: "Name",
  modified: "Modified",
  type: "Type",
};

interface LayoutState {
  // workspace path → sidebar width in CSS px. Clamped on read so any
  // out-of-range persisted values get repaired automatically.
  sidebarWidth: Record<string, number>;
  // workspace path → hidden flag. Hiding preserves the last width so re-show
  // restores it; per-workspace so users can keep different defaults.
  sidebarHidden: Record<string, boolean>;
  // S-FT-022: per-workspace FileTree sort mode + folders-first.
  sortMode: Record<string, SortMode>;
  foldersFirst: Record<string, boolean>;
  // S-FT-024: show dotfiles. Default OFF — `.markspread/` is internal.
  showHidden: Record<string, boolean>;
  // S-SBC-003: when sidebarHidden=true, render a slim "rail" by default so
  // the user has a hover/click target to reopen; "hidden" hides completely.
  sidebarCollapsedMode: Record<string, SidebarCollapsedMode>;
  getSidebarWidth: (workspace: string) => number;
  setSidebarWidth: (workspace: string, width: number) => void;
  isSidebarHidden: (workspace: string) => boolean;
  setSidebarHidden: (workspace: string, hidden: boolean) => void;
  toggleSidebar: (workspace: string) => void;
  getSortMode: (workspace: string) => SortMode;
  setSortMode: (workspace: string, mode: SortMode) => void;
  isFoldersFirst: (workspace: string) => boolean;
  setFoldersFirst: (workspace: string, value: boolean) => void;
  isShowHidden: (workspace: string) => boolean;
  setShowHidden: (workspace: string, value: boolean) => void;
  toggleShowHidden: (workspace: string) => void;
  getSidebarCollapsedMode: (workspace: string) => SidebarCollapsedMode;
  setSidebarCollapsedMode: (workspace: string, mode: SidebarCollapsedMode) => void;
}

export const clampSidebarWidth = (n: number): number => {
  if (!Number.isFinite(n)) return SIDEBAR_DEFAULT_PX;
  return Math.max(SIDEBAR_MIN_PX, Math.min(SIDEBAR_MAX_PX, Math.round(n)));
};

/**
 * S-FT-020: per-workspace sidebar width persistence. Stored in localStorage
 * keyed by window id so multi-window layouts can diverge intentionally.
 */
export const useLayout = create<LayoutState>()(
  persist(
    (set, get) => ({
      sidebarWidth: {},
      sidebarHidden: {},
      sortMode: {},
      foldersFirst: {},
      showHidden: {},
      sidebarCollapsedMode: {},
      getSidebarWidth: (workspace) => {
        const v = get().sidebarWidth[workspace];
        return v == null ? SIDEBAR_DEFAULT_PX : clampSidebarWidth(v);
      },
      setSidebarWidth: (workspace, width) => {
        const clamped = clampSidebarWidth(width);
        if (get().sidebarWidth[workspace] === clamped) return;
        set({
          sidebarWidth: { ...get().sidebarWidth, [workspace]: clamped },
        });
      },
      isSidebarHidden: (workspace) => !!get().sidebarHidden[workspace],
      setSidebarHidden: (workspace, hidden) => {
        if (!!get().sidebarHidden[workspace] === hidden) return;
        set({
          sidebarHidden: { ...get().sidebarHidden, [workspace]: hidden },
        });
      },
      toggleSidebar: (workspace) => {
        const cur = !!get().sidebarHidden[workspace];
        set({
          sidebarHidden: { ...get().sidebarHidden, [workspace]: !cur },
        });
      },
      getSortMode: (workspace) => get().sortMode[workspace] ?? "name",
      setSortMode: (workspace, mode) => {
        if (get().sortMode[workspace] === mode) return;
        set({
          sortMode: { ...get().sortMode, [workspace]: mode },
        });
      },
      // Folders-first defaults to ON to match user expectations (matches the
      // pre-S-FT-022 behavior). The persisted absence of a value is treated
      // as ON so existing users don't see their tree reorder on upgrade.
      isFoldersFirst: (workspace) => {
        const v = get().foldersFirst[workspace];
        return v == null ? true : v;
      },
      setFoldersFirst: (workspace, value) => {
        if (!!get().foldersFirst[workspace] === value) return;
        set({
          foldersFirst: { ...get().foldersFirst, [workspace]: value },
        });
      },
      isShowHidden: (workspace) => !!get().showHidden[workspace],
      setShowHidden: (workspace, value) => {
        if (!!get().showHidden[workspace] === value) return;
        set({
          showHidden: { ...get().showHidden, [workspace]: value },
        });
      },
      toggleShowHidden: (workspace) => {
        const cur = !!get().showHidden[workspace];
        set({
          showHidden: { ...get().showHidden, [workspace]: !cur },
        });
      },
      // Default "rail": collapsed sidebar still shows a 6px handle so users
      // never lose the affordance to reopen. Users who want a fully clean
      // editor (esp. on small displays) can switch to "hidden" via Settings.
      getSidebarCollapsedMode: (workspace) =>
        get().sidebarCollapsedMode[workspace] ?? "rail",
      setSidebarCollapsedMode: (workspace, mode) => {
        if (get().sidebarCollapsedMode[workspace] === mode) return;
        set({
          sidebarCollapsedMode: {
            ...get().sidebarCollapsedMode,
            [workspace]: mode,
          },
        });
      },
    }),
    { name: persistKeyFor("markspread.layout") },
  ),
);
