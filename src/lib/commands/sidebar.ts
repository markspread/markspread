import { useLayout } from "../../store/layout";
import { useSidebarPeek } from "../../store/sidebar-peek";
import { useWorkspace } from "../../store/workspace";

/**
 * S-FT-021: ⌘B / Ctrl+B toggle for the FileTree sidebar. No-op when no
 * workspace is open (the single-file screen has no sidebar).
 */
export function toggleSidebarCommand(): void {
  const ws = useWorkspace.getState().current;
  if (!ws) return;
  useLayout.getState().toggleSidebar(ws);
}

/**
 * S-FT-024: command-palette flip for `.dotfile` visibility, scoped to the
 * current workspace. Default OFF, persisted per-workspace.
 */
export function toggleHiddenFilesCommand(): void {
  const ws = useWorkspace.getState().current;
  if (!ws) return;
  useLayout.getState().toggleShowHidden(ws);
}

/**
 * S-SBC-005: explicit "show" / "hide" variants for the command palette.
 * `toggleSidebarCommand` flips state regardless of current; the palette
 * benefits from intent-revealing names so users searching "show sidebar"
 * vs "hide sidebar" each find what they expect.
 */
export function showSidebarCommand(): void {
  const ws = useWorkspace.getState().current;
  if (!ws) return;
  useLayout.getState().setSidebarHidden(ws, false);
}

export function hideSidebarCommand(): void {
  const ws = useWorkspace.getState().current;
  if (!ws) return;
  useLayout.getState().setSidebarHidden(ws, true);
}

/**
 * S-SBP-009: keyboard-only path into the peek overlay. No-op when the
 * sidebar is already pinned open — peek over the persistent sidebar
 * would just duplicate the tree (ADR-0002 D1). When invoked from a
 * shortcut, focus jumps into the tree after mount so the user can
 * immediately arrow-key around without an extra Tab.
 */
export function peekSidebarCommand(): void {
  const ws = useWorkspace.getState().current;
  if (!ws) return;
  if (!useLayout.getState().isSidebarHidden(ws)) return;
  useSidebarPeek
    .getState()
    .show(document.activeElement instanceof HTMLElement ? document.activeElement : null);
}
