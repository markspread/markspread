import { ask } from "@tauri-apps/plugin-dialog";
import { useSettings } from "../../store/settings";
import { useTabs } from "../../store/tabs";
import { useToasts } from "../../store/toasts";
import { useWorkspace } from "../../store/workspace";

/**
 * S-WS-013: close the active workspace and return to the start screen.
 * The Tauri window stays alive — this is a state transition, not a quit.
 *
 * Behavior:
 *   - If no tabs are dirty → close immediately.
 *   - If autosaveOnClose=true → emit save events for dirty tabs and close.
 *     (Actual save IPC lives in the editor unit; for now we surface a toast.)
 *   - Otherwise → ask the user to confirm discard / cancel.
 */
export async function closeWorkspaceCommand(): Promise<boolean> {
  const ws = useWorkspace.getState();
  if (!ws.current) return true;

  const tabs = useTabs.getState();
  const dirtyPaths = tabs.tabs.filter((t) => t.dirty).map((t) => t.path);

  if (dirtyPaths.length > 0) {
    const autosave = useSettings.getState().autosaveOnClose;
    if (autosave) {
      // S-ED-* will own the actual save IPC. We mark the intent so the editor
      // module can flush on its next tick; the toast tells the user we did
      // something rather than silently dropping their changes.
      window.dispatchEvent(
        new CustomEvent("markspread:save-all-then-close", {
          detail: { paths: dirtyPaths },
        }),
      );
      useToasts.getState().push({
        kind: "info",
        message: "workspace.close.autosaved",
        details: `${dirtyPaths.length} file(s)`,
        ttlMs: 4000,
      });
    } else {
      const proceed = await ask(
        `${dirtyPaths.length}개 파일이 저장되지 않았습니다. 변경사항을 버리고 워크스페이스를 닫으시겠습니까?`,
        { title: "Markspread — 워크스페이스 닫기", kind: "warning" },
      );
      if (!proceed) return false;
    }
  }

  ws.close();
  useTabs.getState().replaceAll([], null);
  return true;
}
