import { invoke } from "@tauri-apps/api/core";
import { ask } from "@tauri-apps/plugin-dialog";
import { useTabs } from "../store/tabs";
import { useToasts } from "../store/toasts";

interface SaveOptions {
  workspace: string;
  path: string;
  content: string;
}

/**
 * S-FT-018: tab save path that respects the orphaned state. If the file was
 * deleted by another process, prompt to recreate it before writing — saving
 * silently would resurrect the file without the user's awareness, which is a
 * surprising side-effect (we don't know whether the deletion was intentional).
 *
 * Returns true on successful write, false on cancel or failure (callers should
 * keep the in-memory dirty state). Toasts surface failure cases.
 */
export async function saveTab({ workspace, path, content }: SaveOptions): Promise<boolean> {
  const tab = useTabs.getState().tabs.find((t) => t.path === path);
  const orphaned = !!tab?.orphaned;

  if (orphaned) {
    const proceed = await ask(
      `이 파일은 더 이상 존재하지 않습니다 (${path}).\n다시 만들어 저장하시겠습니까?`,
      {
        title: "Markspread — 외부 삭제 감지",
        kind: "warning",
        okLabel: "Recreate",
        cancelLabel: "Keep in memory",
      },
    );
    if (!proceed) return false;
    try {
      await invoke("fs_create_file", { workspace, path });
    } catch (err) {
      const msg = String((err as { message?: string })?.message ?? err);
      // Path may already exist again (e.g., user restored it manually). Fall
      // through to fs_write — duplicates are surfaced there.
      if (!msg.includes("already")) {
        useToasts.getState().push({
          kind: "error",
          message: "save.recreate_failed",
          details: msg,
          ttlMs: 4000,
        });
        return false;
      }
    }
  }

  try {
    await invoke("fs_write", { workspace, path, content });
    useTabs.getState().setOrphaned(path, false);
    useTabs.getState().setDirty(path, false);
    return true;
  } catch (err) {
    const msg = String((err as { message?: string })?.message ?? err);
    useToasts.getState().push({
      kind: "error",
      message: "save.failed",
      details: msg,
      ttlMs: 4000,
    });
    return false;
  }
}
