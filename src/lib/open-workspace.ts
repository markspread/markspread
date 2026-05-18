import { invoke } from "@tauri-apps/api/core";
import { ask, message, open as openDialog } from "@tauri-apps/plugin-dialog";
import { useRecentWorkspaces } from "../store/recent-workspaces";
import { useToasts } from "../store/toasts";
import { useWorkspace } from "../store/workspace";

interface AppError {
  code: string;
  message: string;
}

function isAppError(value: unknown): value is AppError {
  return (
    typeof value === "object" &&
    value !== null &&
    typeof (value as AppError).code === "string" &&
    typeof (value as AppError).message === "string"
  );
}

async function presentScaffoldError(err: unknown): Promise<void> {
  if (isAppError(err)) {
    if (err.code === "EACCES" || err.code === "EROFS" || err.code === "EPERM") {
      await message(err.message, {
        title: "권한 부족",
        kind: "warning",
      });
      return;
    }
    if (err.code === "ENOSPC") {
      await message(err.message, { title: "디스크 공간 부족", kind: "error" });
      return;
    }
    useToasts.getState().push({
      kind: "error",
      message: err.message,
      details: err.code,
    });
    return;
  }
  useToasts.getState().push({
    kind: "error",
    message: String(err),
  });
}

interface WorkspaceLayout {
  root: string;
  meta_dir: string;
  settings: string;
  index_db: string;
  snapshots: string;
  already_existed: boolean;
  settings_schema_version: number | null;
  current_schema_version: number;
  index_db_corrupt: boolean;
  read_only: boolean;
}

interface WorkspaceInspection {
  root: string;
  already_existed: boolean;
  settings_schema_version: number | null;
  current_schema_version: number;
  index_db_corrupt: boolean;
  read_only: boolean;
}

// S-WS-006: a workspace path > 240 chars is well past the Windows MAX_PATH
// envelope. Even with longPathAware=true the binary itself is fine, but some
// system tools (Explorer right-click, older sync clients) silently truncate.
// We notify once per workspace so the user can react if they care.
const LONG_PATH_THRESHOLD = 240;
const longPathSeen = new Set<string>();
const externalDriveSeen = new Set<string>();

interface DriveInfo {
  kind: "internal" | "external" | "network" | "unknown";
  case_preserving_only: boolean;
}

async function settingsRecoveryGuard(rootPath: string): Promise<boolean> {
  // S-WS-021: detect a settings.json that exists but won't parse. If the
  // user picks "default values" we move the broken file aside and proceed;
  // otherwise we abort so they can hand-edit and retry.
  let intact: boolean;
  try {
    intact = await invoke<boolean>("workspace_settings_check", {
      workspace: rootPath,
    });
  } catch {
    // File is corrupt (parse error returned as Err). Fall through to dialog.
    intact = false;
  }
  if (intact) return true;

  // Distinguish "file exists but corrupt" from "file missing" — the former
  // returns Err, the latter returns Ok(false). Re-call to get the boolean
  // for confirmation; if the call errors here it's the corrupt path.
  let proceed: boolean | null = null;
  try {
    proceed = await ask(
      ".markspread/settings.json 파일이 손상되었습니다. 기본값으로 복원하시겠습니까? 손상된 파일은 settings.json.broken-<timestamp>으로 보관됩니다.",
      { title: "Markspread — 설정 복구", kind: "warning" },
    );
  } catch {}

  if (proceed) {
    try {
      const quarantine = await invoke<string>("workspace_settings_recover", {
        workspace: rootPath,
      });
      useToasts.getState().push({
        kind: "info",
        message: "workspace.settings.restored",
        details: quarantine,
        ttlMs: 8000,
      });
      return true;
    } catch (e) {
      useToasts.getState().push({
        kind: "error",
        message: "workspace.settings.recover_failed",
        details: String(e),
      });
      return false;
    }
  }
  return false;
}

async function evaluateAndOpen(layout: WorkspaceLayout): Promise<void> {
  if (!(await settingsRecoveryGuard(layout.root))) return;

  const v = layout.settings_schema_version;
  if (v !== null && v > layout.current_schema_version) {
    useToasts.getState().push({
      kind: "error",
      message: "workspace.error.schema_too_new",
      details: `settings.json schemaVersion=${v}, app supports ${layout.current_schema_version}`,
    });
    return;
  }
  if (layout.index_db_corrupt) {
    // S-WS-022: quarantine the broken DB and kick off a background rebuild.
    // Search stays usable but degraded (callers see Empty/Rebuilding state)
    // until `fs:index:done` fires.
    try {
      const quarantine = await invoke<string>("workspace_index_quarantine", {
        workspace: layout.root,
      });
      useToasts.getState().push({
        kind: "warning",
        message: "workspace.warn.index_corrupt",
        details: quarantine || "index.db",
        ttlMs: 8000,
      });
      void invoke("fs_index_rebuild", { workspace: layout.root }).catch((e) => {
        useToasts.getState().push({
          kind: "error",
          message: "workspace.error.index_rebuild_failed",
          details: String(e),
        });
      });
    } catch (e) {
      useToasts.getState().push({
        kind: "error",
        message: "workspace.warn.index_corrupt",
        details: String(e),
      });
    }
  }
  if (layout.root.length > LONG_PATH_THRESHOLD && !longPathSeen.has(layout.root)) {
    longPathSeen.add(layout.root);
    useToasts.getState().push({
      kind: "info",
      message: "workspace.warn.long_path",
      details: `${layout.root.length} chars`,
      ttlMs: 8000,
    });
  }

  try {
    const drive = await invoke<DriveInfo>("drive_classify", {
      path: layout.root,
    });
    if (drive.kind === "external" && !externalDriveSeen.has(layout.root)) {
      externalDriveSeen.add(layout.root);
      useToasts.getState().push({
        kind: "warning",
        message: "workspace.warn.external_drive",
        ...(drive.case_preserving_only && {
          details: "FAT/exFAT 케이스 보존 정책 적용",
        }),
        ttlMs: 10000,
      });
    } else if (drive.kind === "network") {
      useToasts.getState().push({
        kind: "info",
        message: "workspace.warn.network_drive",
        ttlMs: 8000,
      });
    }
  } catch {}

  if (layout.read_only) {
    useToasts.getState().push({
      kind: "info",
      message: "workspace.read_only.notice",
      details: "편집 변경은 메모리에만 보관 — Save → Save As 분기됩니다",
      ttlMs: 8000,
    });
  }

  useWorkspace.getState().open(layout.root, { readOnly: layout.read_only });
  useRecentWorkspaces.getState().add(layout.root);
}

export async function openWorkspaceFromDialog(): Promise<string | null> {
  const selected = await openDialog({
    directory: true,
    multiple: false,
    title: "Open workspace folder",
  });
  if (typeof selected !== "string" || selected.length === 0) {
    return null;
  }

  let inspection: WorkspaceInspection;
  try {
    inspection = await invoke<WorkspaceInspection>("workspace_inspect", {
      workspace: selected,
    });
  } catch (err) {
    await presentScaffoldError(err);
    return null;
  }

  if (!inspection.already_existed) {
    const proceed = await ask(
      "이 폴더에는 아직 워크스페이스가 없습니다. 새 워크스페이스로 초기화하시겠습니까?",
      { title: "Markspread", kind: "info" },
    );
    if (!proceed) return null;
  }

  let layout: WorkspaceLayout;
  try {
    layout = await invoke<WorkspaceLayout>("workspace_scaffold", {
      workspace: selected,
    });
  } catch (err) {
    await presentScaffoldError(err);
    return null;
  }
  await evaluateAndOpen(layout);
  return layout.root;
}

export async function newWorkspaceFromDialog(): Promise<string | null> {
  const selected = await openDialog({
    directory: true,
    multiple: false,
    title: "Choose folder for new workspace",
  });
  if (typeof selected !== "string" || selected.length === 0) {
    return null;
  }
  let layout: WorkspaceLayout;
  try {
    layout = await invoke<WorkspaceLayout>("workspace_scaffold", {
      workspace: selected,
    });
  } catch (err) {
    await presentScaffoldError(err);
    return null;
  }
  if (layout.already_existed) {
    const proceed = await ask("이미 워크스페이스로 초기화된 폴더입니다. 다시 여시겠습니까?", {
      title: "Markspread",
      kind: "info",
    });
    if (!proceed) return null;
  }
  await evaluateAndOpen(layout);
  return layout.root;
}
