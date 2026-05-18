import { invoke } from "@tauri-apps/api/core";
import { ask } from "@tauri-apps/plugin-dialog";
import { useRecentWorkspaces } from "../../store/recent-workspaces";
import { useSettings } from "../../store/settings";
import { useTabs } from "../../store/tabs";
import { useToasts } from "../../store/toasts";
import { useWorkspace } from "../../store/workspace";
import { useWorkspaceSessions } from "../../store/workspace-sessions";

interface WorkspaceLayout {
  root: string;
}

/**
 * S-WS-014: switch from current workspace to `target`.
 * Snapshots the live tab state into per-workspace sessions, handles dirty
 * tabs (save/discard/cancel), then opens the new workspace and restores its
 * previous tabs.
 */
export async function switchWorkspaceCommand(target: string): Promise<boolean> {
  const ws = useWorkspace.getState();
  if (ws.current === target) return true;

  const tabs = useTabs.getState();
  const dirtyPaths = tabs.tabs.filter((t) => t.dirty).map((t) => t.path);

  if (dirtyPaths.length > 0) {
    const autosave = useSettings.getState().autosaveOnClose;
    if (autosave) {
      window.dispatchEvent(
        new CustomEvent("markspread:save-all-then-close", {
          detail: { paths: dirtyPaths },
        }),
      );
    } else {
      const proceed = await ask(
        `${dirtyPaths.length}개 파일이 저장되지 않았습니다. 변경사항을 버리고 전환하시겠습니까?`,
        { title: "Markspread — 워크스페이스 전환", kind: "warning" },
      );
      if (!proceed) return false;
    }
  }

  // Snapshot current → sessions store before we mutate the live tabs.
  if (ws.current) {
    useWorkspaceSessions.getState().saveSession(ws.current, {
      tabs: tabs.tabs,
      activePath: tabs.activePath,
    });
  }

  // Best-effort hot-swap: scaffold (or open existing) target before tearing
  // down. If it errors, leave the current workspace intact.
  let layout: WorkspaceLayout;
  try {
    layout = await invoke<WorkspaceLayout>("workspace_scaffold", {
      workspace: target,
    });
  } catch (e) {
    useToasts.getState().push({
      kind: "error",
      message: "workspace.switch.failed",
      details: String(e),
    });
    return false;
  }

  ws.open(layout.root);
  useRecentWorkspaces.getState().add(layout.root);

  const restored = useWorkspaceSessions.getState().loadSession(layout.root);
  if (restored) {
    useTabs.getState().replaceAll(restored.tabs, restored.activePath);
  } else {
    useTabs.getState().replaceAll([], null);
  }
  return true;
}
