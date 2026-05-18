import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { ask } from "@tauri-apps/plugin-dialog";
import { locateWorkspaceCommand } from "./commands/locate-workspace";
import { useTabs } from "../store/tabs";
import { useToasts } from "../store/toasts";
import { useWorkspace } from "../store/workspace";

interface DisconnectedPayload {
  workspace: string;
}

interface DriveInfo {
  kind: "internal" | "external" | "network" | "unknown";
}

const watching = new Set<string>();

/**
 * S-WS-020: arm the unmount watcher whenever the active workspace lives on
 * an external or network volume. Internal disks won't get yanked, so we
 * skip the polling overhead.
 */
export async function maybeStartUnmountWatch(workspace: string): Promise<void> {
  if (watching.has(workspace)) return;
  let kind: DriveInfo["kind"] = "unknown";
  try {
    const drive = await invoke<DriveInfo>("drive_classify", {
      path: workspace,
    });
    kind = drive.kind;
  } catch {}
  if (kind !== "external" && kind !== "network") return;

  try {
    await invoke("unmount_watch_start", { workspace });
    watching.add(workspace);
  } catch {}
}

export async function stopUnmountWatch(workspace: string): Promise<void> {
  if (!watching.has(workspace)) return;
  try {
    await invoke("unmount_watch_stop", { workspace });
  } catch {}
  watching.delete(workspace);
}

/**
 * Wires the global `workspace:disconnected` listener. Called once at boot.
 * On disconnect we dump dirty buffers (best effort) before closing the
 * workspace so the user can recover after re-mounting the drive.
 */
export function registerUnmountListener(): () => void {
  let unlisten: (() => void) | null = null;
  listen<DisconnectedPayload>("workspace:disconnected", async (evt) => {
    const ws = evt.payload.workspace;
    const current = useWorkspace.getState().current;
    if (current !== ws) return;

    const tabs = useTabs.getState().tabs;
    const dirty = tabs.filter((t) => t.dirty);
    let dumped = 0;
    for (const tab of dirty) {
      // Tab content lives in the editor module; fall back to relative path
      // alone so the orphan filename is still meaningful even when we have
      // no buffer text yet (the editor will own actual contents in S-ED-*).
      const rel = tab.path.startsWith(ws) ? tab.path.slice(ws.length + 1) : tab.path;
      try {
        await invoke("unmount_dump_orphan", {
          relativePath: rel,
          contents: "",
        });
        dumped += 1;
      } catch {}
    }

    useToasts.getState().push({
      kind: "warning",
      message: "workspace.disconnected",
      details:
        dumped > 0
          ? `${dumped}개 파일 임시 보관 (~/.markspread/snapshots/orphans/)`
          : ws,
      ttlMs: 12000,
    });
    watching.delete(ws);

    // S-WS-023: offer to point at the new location before tearing down. If
    // the user cancels (or `locate` fails) we close as the unmount path
    // intends. If they relocate, the workspace state has already been
    // updated by `locateWorkspaceCommand`.
    const wantsLocate = await ask(
      "워크스페이스 폴더가 이동·이름변경되었거나 드라이브가 분리된 것 같습니다. 새 위치를 지정하시겠습니까?",
      { title: "Markspread — 워크스페이스 위치", kind: "warning" },
    );
    if (wantsLocate) {
      const ok = await locateWorkspaceCommand(ws);
      if (ok) return;
    }

    useWorkspace.getState().close();
    useTabs.getState().replaceAll([], null);
  })
    .then((u) => {
      unlisten = u;
    })
    .catch(() => {});
  return () => unlisten?.();
}
