import { invoke } from "@tauri-apps/api/core";
import { type UnlistenFn, listen } from "@tauri-apps/api/event";
import { getCurrentWebview } from "@tauri-apps/api/webview";
import { ask } from "@tauri-apps/plugin-dialog";
import { useRecentWorkspaces } from "../store/recent-workspaces";
import { useSingleFile } from "../store/single-file";
import { useToasts } from "../store/toasts";
import { useWorkspace } from "../store/workspace";
import { parentDir } from "./open-md-file";

// S-FT-011: track Meta/Ctrl during OS drag — `onDragDropEvent` doesn't expose
// modifier state, so we shadow it from window keydown/keyup. Released-by-blur
// is intentionally not handled — worst case the next drop interprets stale
// state, which the user can reproduce identically to verify.
let metaDown = false;
window.addEventListener("keydown", (e) => {
  if (e.key === "Meta" || e.key === "Control") metaDown = true;
});
window.addEventListener("keyup", (e) => {
  if (e.key === "Meta" || e.key === "Control") metaDown = false;
});

interface FsStat {
  kind: "dir" | "file" | "symlink";
}

// FIX: Rust fs_read_file 의 실제 반환 shape.
interface FsReadFileResult {
  content: string;
  encoding: string;
}

interface WorkspaceLayout {
  root: string;
  already_existed: boolean;
}

interface WorkspaceInspection {
  already_existed: boolean;
}

async function dropFolder(path: string): Promise<void> {
  const inWorkspace = useWorkspace.getState().current !== null;
  let inspection: WorkspaceInspection;
  try {
    inspection = await invoke<WorkspaceInspection>("workspace_inspect", {
      workspace: path,
    });
  } catch (e) {
    useToasts.getState().push({
      kind: "error",
      message: "dnd.error.inspect_failed",
      details: String(e),
    });
    return;
  }

  if (inWorkspace) {
    const proceed = await ask("현재 워크스페이스를 닫고 이 폴더로 전환하시겠습니까?", {
      title: "Markspread — 워크스페이스 전환",
      kind: "warning",
    });
    if (!proceed) return;
  } else if (!inspection.already_existed) {
    const proceed = await ask(
      "이 폴더에는 아직 워크스페이스가 없습니다. 새 워크스페이스로 초기화하시겠습니까?",
      { title: "Markspread", kind: "info" },
    );
    if (!proceed) return;
  }

  try {
    const layout = await invoke<WorkspaceLayout>("workspace_scaffold", {
      workspace: path,
    });
    useWorkspace.getState().open(layout.root);
    useRecentWorkspaces.getState().add(layout.root);
  } catch (e) {
    useToasts.getState().push({
      kind: "error",
      message: "dnd.error.open_failed",
      details: String(e),
    });
  }
}

/**
 * S-FT-011: drop OS files into the open workspace. Default = copy; ⌘+Drop on
 * macOS or Ctrl+Drop on Win/Linux switches to move. Per-file conflict prompt
 * (rename suffix vs overwrite) keeps things simple — we don't try to batch
 * "Apply to all" yet. Cancel ends the loop after the in-flight file finishes.
 */
async function importIntoWorkspace(
  workspace: string,
  destDir: string,
  paths: string[],
): Promise<void> {
  const move = metaDown;
  const toasts = useToasts.getState();
  const jobId = `import-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  // Live counters maintained from backend progress events.
  let liveFiles = 0;
  let liveBytes = 0;

  const formatBytes = (n: number): string => {
    if (n < 1024) return `${n} B`;
    if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
    if (n < 1024 * 1024 * 1024) return `${(n / 1024 / 1024).toFixed(1)} MB`;
    return `${(n / 1024 / 1024 / 1024).toFixed(2)} GB`;
  };
  const detailFor = (topIdx: number) =>
    `${topIdx} / ${paths.length} top, ${liveFiles} files, ${formatBytes(liveBytes)}`;

  const progressId = toasts.push({
    kind: "info",
    message: move ? "filetree.import.moving" : "filetree.import.copying",
    details: detailFor(0),
    ttlMs: 0,
    action: {
      label: "Cancel",
      onClick: () => {
        importCancel.requested = true;
      },
    },
  });

  let unlistenProgress: UnlistenFn | null = null;
  try {
    unlistenProgress = await listen<{
      job_id: string | null;
      files_done: number;
      bytes_done: number;
    }>("fs:import:progress", (e) => {
      if (e.payload.job_id !== jobId) return;
      liveFiles = e.payload.files_done;
      liveBytes = e.payload.bytes_done;
      // Re-read top index from the closure isn't possible — we update only
      // the per-file counters and refresh the details string on every tick.
      useToasts.getState().update(progressId, {
        details: `${liveFiles} files, ${formatBytes(liveBytes)}`,
      });
      // S-FT-012: 10K-file threshold prompts a "still running" hint so the
      // user knows it's safe to keep working in another window.
      if (liveFiles === 10000) {
        useToasts.getState().push({
          kind: "info",
          message: "filetree.import.long_running",
          ttlMs: 5000,
        });
      }
    });
  } catch {
    // listen failed (no Tauri runtime?) — fall through, we'll just lack
    // per-file counts but the top-level loop counter still works.
  }

  let imported = 0;
  let skipped = 0;
  for (let i = 0; i < paths.length; i += 1) {
    const src = paths[i];
    if (importCancel.requested) break;
    /* v8 ignore next -- noUncheckedIndexedAccess defensive: i < paths.length guarantees src is defined */
    if (src === undefined) continue;
    /* v8 ignore next -- src is a non-empty Tauri-supplied path so split() always yields at least one segment */
    const baseName = src.split(/[/\\]/).filter(Boolean).pop() ?? `imported-${imported}`;
    let target = `${destDir.replace(/[/\\]+$/, "")}/${baseName}`;
    let exists = await fileExists(workspace, target);
    if (exists) {
      const choice = await ask(
        `이미 존재하는 항목: ${baseName}\n덮어쓰시겠습니까? 취소하면 자동으로 새 이름이 부여됩니다.`,
        {
          title: "Markspread — 충돌",
          kind: "warning",
          okLabel: "Overwrite",
          cancelLabel: "Rename",
        },
      );
      if (!choice) {
        target = await pickRenameTarget(workspace, destDir, baseName);
        exists = false;
      }
    }
    try {
      if (move) {
        await invoke("fs_move", { workspace, from: src, to: target });
      } else {
        await invoke("fs_import_copy", {
          workspace,
          source: src,
          dest: target,
          overwrite: exists,
          jobId,
        });
      }
      imported += 1;
    } catch (e) {
      skipped += 1;
      toasts.push({
        kind: "warning",
        message: "filetree.import.item_failed",
        details: `${baseName}: ${String(e)}`,
        ttlMs: 4000,
      });
    }
    useToasts.getState().update(progressId, {
      details: detailFor(i + 1),
    });
  }

  unlistenProgress?.();
  toasts.dismiss(progressId);

  if (importCancel.requested) {
    toasts.push({
      kind: "info",
      message: "filetree.import.cancelled",
      details: `${imported} / ${paths.length}`,
      ttlMs: 3500,
    });
  } else if (imported + skipped > 0) {
    toasts.push({
      kind: "success",
      message: "filetree.import.done",
      details: `${imported} imported, ${skipped} skipped, ${liveFiles} files, ${formatBytes(liveBytes)}`,
      ttlMs: 4000,
    });
  }
  importCancel.requested = false;
}

const importCancel = { requested: false };

async function fileExists(workspace: string, path: string): Promise<boolean> {
  try {
    await invoke("fs_stat", { workspace, path });
    return true;
  } catch {
    return false;
  }
}

async function pickRenameTarget(
  workspace: string,
  destDir: string,
  baseName: string,
): Promise<string> {
  const dot = baseName.lastIndexOf(".");
  const stem = dot > 0 ? baseName.slice(0, dot) : baseName;
  const ext = dot > 0 ? baseName.slice(dot) : "";
  for (let i = 1; i < 1000; i += 1) {
    const candidate = `${destDir.replace(/[/\\]+$/, "")}/${stem} (${i})${ext}`;
    if (!(await fileExists(workspace, candidate))) return candidate;
  }
  return `${destDir.replace(/[/\\]+$/, "")}/${stem}-${Date.now()}${ext}`;
}

async function dropFile(path: string): Promise<void> {
  // S-FL-013: dropping a file routes to single-file mode regardless of where
  // we currently are. The single-file screen has its own "convert to
  // workspace" CTA for users who want the full surface.
  try {
    // FIX: fs_read 는 workspace 인자 필요 + 반환은 String 이 아니라 FsReadFileResult.
    //      이전 코드는 invoke 단계에서 실패 → drag-drop 으로 파일 못 열림.
    const workspace = parentDir(path);
    const result = await invoke<FsReadFileResult>("fs_read_file", {
      workspace,
      path,
    });
    useWorkspace.getState().close();
    useSingleFile.getState().open(path, result.content);
  } catch (e) {
    useToasts.getState().push({
      kind: "error",
      message: "dnd.error.file_open_failed",
      details: String(e),
    });
  }
}

export function registerDragDrop(): () => void {
  // S-FT-011: Tauri 런타임이 아닐 때(브라우저 dev/preview)는 no-op.
  // `getCurrentWebview()`는 `__TAURI_INTERNALS__` 메타데이터에 의존한다.
  if (typeof window === "undefined" || !("__TAURI_INTERNALS__" in window)) {
    return () => {};
  }
  const webview = getCurrentWebview();
  let unlisten: (() => void) | null = null;
  webview
    .onDragDropEvent(async (evt) => {
      if (evt.payload.type !== "drop") return;
      /* v8 ignore next -- Tauri's drop payload always carries a paths array; the ?? fallback is defensive */
      const paths = evt.payload.paths ?? [];
      if (paths.length === 0) return;
      // S-FT-011: when a workspace is already open and the drop landed inside
      // the FileTree element, treat it as an import rather than a workspace
      // switch. Multi-file imports go through the bulk path; a single dropped
      // folder/file outside the tree still routes to the open/switch flow.
      const ws = useWorkspace.getState().current;
      if (ws && evt.payload.position && paths.length > 0) {
        const tree = document.querySelector<HTMLElement>('[data-filetree-root="true"]');
        if (tree) {
          /* v8 ignore next -- window.devicePixelRatio is always a positive number in browsers; the `|| 1` fallback is defensive */
          const dpr = window.devicePixelRatio || 1;
          const x = evt.payload.position.x / dpr;
          const y = evt.payload.position.y / dpr;
          const r = tree.getBoundingClientRect();
          if (x >= r.left && x <= r.right && y >= r.top && y <= r.bottom) {
            await importIntoWorkspace(ws, ws, paths);
            return;
          }
        }
      }
      // Only the first path drives the routing decision; the rest are queued
      // as additional tabs once the workspace is open (FT will handle).
      const head = paths[0];
      /* v8 ignore next -- paths.length > 0 was checked above, so head is always defined */
      if (head === undefined) return;
      try {
        const stat = await invoke<FsStat>("fs_stat", { path: head });
        if (stat.kind === "dir") {
          await dropFolder(head);
        } else {
          await dropFile(head);
        }
      } catch (e) {
        useToasts.getState().push({
          kind: "error",
          message: "dnd.error.stat_failed",
          details: String(e),
        });
      }
    })
    .then((u) => {
      unlisten = u;
    })
    .catch(() => {});
  return () => {
    unlisten?.();
  };
}
