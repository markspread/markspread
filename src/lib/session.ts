import { invoke } from "@tauri-apps/api/core";
import { fromLegacyTabs } from "./editor/layout-model";
import { useEditorLayout } from "../store/editor-layout";
import { useSingleFile } from "../store/single-file";
import { useTabs } from "../store/tabs";
import { useToasts } from "../store/toasts";
import { useWorkspace } from "../store/workspace";
import { routeCliPathArg } from "./cli-route";

interface CliFlags {
  no_restore: boolean;
  headless_cold_start: boolean;
  path_arg: string | null;
}

interface FsStat {
  kind: "dir" | "file" | "symlink";
  modified_ms?: number;
}

export async function restoreSessionOrFallback(): Promise<void> {
  let flags: CliFlags = {
    no_restore: false,
    headless_cold_start: false,
    path_arg: null,
  };
  try {
    flags = await invoke<CliFlags>("cli_flags");
  } catch {}

  // CLI path argument wins over restored session (S-WS-011).
  if (flags.path_arg) {
    await routeCliPathArg(flags.path_arg);
    return;
  }

  const persisted = useWorkspace.getState().current;
  if (!persisted) return;

  if (flags.no_restore) {
    useWorkspace.getState().close();
    useTabs.getState().replaceAll([], null);
    useSingleFile.getState().close();
    return;
  }

  try {
    // The persisted path is a workspace root; stat it via "." since
    // fs_stat refuses bare absolute paths without a workspace anchor.
    const stat = await invoke<FsStat>("fs_stat", { workspace: persisted, path: "." });
    if (stat.kind !== "dir") {
      useWorkspace.getState().close();
      return;
    }
  } catch {
    // Workspace path missing/inaccessible — defer to S-WS-019 by going back to
    // Welcome. The Welcome screen already lists this path under Recent if the
    // user wants to retry.
    useWorkspace.getState().close();
    return;
  }

  await reconcileRestoredTabs();
  seedEditorLayoutFromLegacy(persisted);
}

// T-U05-007: upgrade path from v1.0 (flat `useTabs`) → v1.1 (per-pane
// `useEditorLayout`). When the workspace has no layout yet but legacy
// tabs exist, mirror them into a single-pane layout so the F4 shell
// (PaneTree → PaneEditor) sees the user's tabs from the first frame.
function seedEditorLayoutFromLegacy(workspace: string): void {
  const layoutStore = useEditorLayout.getState();
  if (layoutStore.layouts[workspace]) return;
  const { tabs, activePath } = useTabs.getState();
  if (tabs.length === 0) return;
  const seeded = fromLegacyTabs(tabs, activePath);
  layoutStore.setLayout(workspace, seeded);
}

async function reconcileRestoredTabs(): Promise<void> {
  const { tabs, activePath, replaceAll } = useTabs.getState();
  if (tabs.length === 0) return;

  const surviving: typeof tabs = [];
  const dropped: string[] = [];
  const externallyChanged: string[] = [];

  const persisted = useWorkspace.getState().current;
  for (const tab of tabs) {
    try {
      // Tab paths are absolute files inside the active workspace.
      // ensure_within() handles absolute target paths correctly.
      const stat = await invoke<FsStat>("fs_stat", {
        workspace: persisted ?? tab.path,
        path: tab.path,
      });
      if (stat.kind === "dir") {
        dropped.push(tab.path);
        continue;
      }
      if (
        tab.modifiedMs !== undefined &&
        stat.modified_ms !== undefined &&
        stat.modified_ms > tab.modifiedMs
      ) {
        externallyChanged.push(tab.path);
      }
      const nextModified = stat.modified_ms ?? tab.modifiedMs;
      surviving.push({
        ...tab,
        ...(nextModified !== undefined && { modifiedMs: nextModified }),
      });
    } catch {
      dropped.push(tab.path);
    }
  }

  const nextActive =
    activePath && surviving.some((t) => t.path === activePath)
      ? activePath
      : (surviving[surviving.length - 1]?.path ?? null);
  replaceAll(surviving, nextActive);

  const toasts = useToasts.getState();
  for (const path of dropped) {
    toasts.push({
      kind: "warning",
      message: "session.tab.missing",
      details: path,
    });
  }
  if (externallyChanged.length > 0) {
    toasts.push({
      kind: "info",
      message: "session.tab.externally_changed",
      details: `${externallyChanged.length} file(s)`,
    });
  }
}
