import { invoke } from "@tauri-apps/api/core";
import { open as openDialog } from "@tauri-apps/plugin-dialog";
import { useRecentWorkspaces } from "../../store/recent-workspaces";
import { useToasts } from "../../store/toasts";
import { useWorkspace } from "../../store/workspace";

interface WorkspaceInspection {
  root: string;
  already_existed: boolean;
}

/**
 * S-WS-023: when the active workspace root has been moved/renamed externally
 * the user picks the new location and we splice Recent + active state to
 * point there. The folder must already contain `.markspread/` — if it doesn't
 * the user probably picked the wrong sibling.
 */
export async function locateWorkspaceCommand(oldPath: string): Promise<boolean> {
  const selected = await openDialog({
    directory: true,
    multiple: false,
    title: "워크스페이스 새 위치 선택",
  });
  if (typeof selected !== "string" || selected.length === 0) return false;

  let inspection: WorkspaceInspection;
  try {
    inspection = await invoke<WorkspaceInspection>("workspace_inspect", {
      workspace: selected,
    });
  } catch (e) {
    useToasts.getState().push({
      kind: "error",
      message: "workspace.locate.failed",
      details: String(e),
    });
    return false;
  }
  if (!inspection.already_existed) {
    useToasts.getState().push({
      kind: "warning",
      message: "workspace.locate.not_a_workspace",
      details: selected,
    });
    return false;
  }

  useWorkspace.getState().open(inspection.root);
  const recent = useRecentWorkspaces.getState();
  recent.remove(oldPath);
  recent.add(inspection.root);
  useToasts.getState().push({
    kind: "info",
    message: "workspace.locate.updated",
    details: inspection.root,
    ttlMs: 6000,
  });
  return true;
}
