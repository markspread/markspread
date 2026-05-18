import { invoke } from "@tauri-apps/api/core";
import { useRecentWorkspaces } from "../store/recent-workspaces";
import { useSingleFile } from "../store/single-file";
import { useToasts } from "../store/toasts";
import { useWorkspace } from "../store/workspace";

interface FsStat {
  kind: "dir" | "file" | "symlink";
}

interface FsReadResult {
  text: string;
}

interface WorkspaceLayout {
  root: string;
}

/**
 * S-WS-011: route a CLI-provided path argument.
 *  - dir   → scaffold-or-open as workspace
 *  - file  → single-file mode
 *  - error → toast + stay on Welcome
 */
export async function routeCliPathArg(rawPath: string): Promise<void> {
  let stat: FsStat;
  try {
    stat = await invoke<FsStat>("fs_stat", { path: rawPath });
  } catch (e) {
    useToasts.getState().push({
      kind: "error",
      message: "cli.error.invalid_path",
      details: String(e),
    });
    return;
  }

  if (stat.kind === "dir") {
    try {
      const layout = await invoke<WorkspaceLayout>("workspace_scaffold", {
        workspace: rawPath,
      });
      useWorkspace.getState().open(layout.root);
      useRecentWorkspaces.getState().add(layout.root);
    } catch (e) {
      useToasts.getState().push({
        kind: "error",
        message: "cli.error.workspace_open_failed",
        details: String(e),
      });
    }
    return;
  }

  try {
    const result = await invoke<FsReadResult>("fs_read", { path: rawPath });
    useWorkspace.getState().close();
    useSingleFile.getState().open(rawPath, result.text);
  } catch (e) {
    useToasts.getState().push({
      kind: "error",
      message: "cli.error.file_open_failed",
      details: String(e),
    });
  }
}
