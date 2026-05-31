import { invoke } from "@tauri-apps/api/core";
import { useRecentWorkspaces } from "../store/recent-workspaces";
import { useSingleFile } from "../store/single-file";
import { useToasts } from "../store/toasts";
import { useWorkspace } from "../store/workspace";
import { parentDir } from "./open-md-file";

interface FsStat {
  kind: "dir" | "file" | "symlink";
}

interface FsReadFileResult {
  content: string;
  encoding: string;
}

interface WorkspaceLayout {
  root: string;
}

/**
 * S-WS-011: route a CLI-provided path argument.
 *  - dir   → scaffold-or-open as workspace
 *  - file  → single-file mode
 *  - error → toast + stay on Welcome
 *
 * The Rust fs_* commands enforce a workspace boundary via
 * `ensure_within(workspace, path)`. For the CLI entry point we don't yet
 * know whether the path is a file or a directory, so we use the path's
 * parent dir as the bounding workspace — that satisfies the invariant for
 * both cases (a dir is contained in its parent; a file is contained in its
 * parent dir).
 */
export async function routeCliPathArg(rawPath: string): Promise<void> {
  const probeWorkspace = parentDir(rawPath);
  let stat: FsStat;
  try {
    stat = await invoke<FsStat>("fs_stat", {
      workspace: probeWorkspace,
      path: rawPath,
    });
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
    const result = await invoke<FsReadFileResult>("fs_read_file", {
      workspace: probeWorkspace,
      path: rawPath,
    });
    useWorkspace.getState().close();
    useSingleFile.getState().open(rawPath, result.content);
  } catch (e) {
    useToasts.getState().push({
      kind: "error",
      message: "cli.error.file_open_failed",
      details: String(e),
    });
  }
}
