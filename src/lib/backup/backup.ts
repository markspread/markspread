// S-BK-001..007: snapshots, recovery, workspace + settings + keybinding
// export/import.
//
// Markspread keeps a rolling local snapshot trail under
// `~/.markspread/snapshots/<workspaceHash>/<isoDate>/` so a user who
// accidentally runs a destructive AI action or overwrites a file can
// roll back without leaving the app. Snapshots are content-addressed
// (the writer dedupes on sha256), so a 5-minute cadence over a 7-day
// window costs ~the size of the unique edits, not 2016 × workspace.
//
// Settings + keybindings have their own export/import paths so users
// can sync them across machines without shipping documents around.

import { invoke } from "@tauri-apps/api/core";

export const SNAPSHOT_INTERVAL_MS = 5 * 60 * 1000;
export const SNAPSHOT_RETENTION_DAYS = 7;

export interface SnapshotConfig {
  enabled: boolean;
  intervalMs: number;
  retentionDays: number;
  /** Per-workspace opt-out — sensitive workspaces can skip snapshotting. */
  excludedWorkspaces: string[];
}

export const DEFAULT_SNAPSHOT_CONFIG: SnapshotConfig = {
  enabled: true,
  intervalMs: SNAPSHOT_INTERVAL_MS,
  retentionDays: SNAPSHOT_RETENTION_DAYS,
  excludedWorkspaces: [],
};

export interface SnapshotRecord {
  id: string;
  ts: number;
  workspaceHash: string;
  /** Number of unique blobs added by this snapshot vs. the previous one. */
  newBlobs: number;
  /** Bytes added by this snapshot. */
  bytesAdded: number;
}

export async function listSnapshots(workspaceHash: string): Promise<SnapshotRecord[]> {
  return invoke<SnapshotRecord[]>("backup_snapshot_list", { workspaceHash });
}

export async function restoreSnapshot(id: string): Promise<{ filesRestored: number }> {
  return invoke<{ filesRestored: number }>("backup_snapshot_restore", { id });
}

// S-BK-003: post-crash recovery dialog. The Rust side surfaces
// candidate snapshots from the last clean exit; the UI lets users pick
// the cut-off (latest, 5 min ago, 30 min ago).
export interface RecoveryProposal {
  workspaceHash: string;
  snapshots: SnapshotRecord[];
  /** When the previous session ended uncleanly. */
  lastSessionEndedAt: number | null;
}

export async function proposeRecovery(workspaceHash: string): Promise<RecoveryProposal> {
  return invoke<RecoveryProposal>("backup_propose_recovery", { workspaceHash });
}

// S-BK-004 / S-BK-005: full-workspace zip. We use `zip` for portability
// (every OS has a built-in unzipper), preserving relative paths so the
// import lands in any chosen destination.
export interface WorkspaceExportRequest {
  workspacePath: string;
  /** Output path; if null, the system save dialog asks. */
  outputPath: string | null;
  /** When true, includes `.markspread/` (settings, snapshots, AI history). */
  includeMarkspreadFolder: boolean;
}

export async function exportWorkspace(req: WorkspaceExportRequest): Promise<{ outputPath: string; bytes: number }> {
  return invoke("backup_workspace_export", { req });
}

export async function importWorkspace(zipPath: string, destination: string): Promise<{ filesRestored: number }> {
  return invoke("backup_workspace_import", { zipPath, destination });
}

// S-BK-006: settings export/import — writes a single JSON document the
// user can drop into version control. We split user-installed plugins
// out into a separate manifest so importing on a fresh machine knows
// which plugins to re-pull from the marketplace.
export interface SettingsExport {
  schemaVersion: 1;
  exportedAt: number;
  /** Free-form settings tree, validated on import against the current schema. */
  settings: Record<string, unknown>;
  /** Plugin id + version, ready to feed into bulk-install. */
  plugins: { id: string; version: string }[];
}

export async function exportSettings(): Promise<SettingsExport> {
  return invoke<SettingsExport>("backup_settings_export");
}

export async function importSettings(payload: SettingsExport): Promise<{ ok: boolean; warnings: string[] }> {
  return invoke("backup_settings_import", { payload });
}

// S-BK-007: keybinding export/import. Smaller, separate file so users
// can share just their keymap without sharing every preference.
export interface KeybindingExport {
  schemaVersion: 1;
  exportedAt: number;
  bindings: { command: string; shortcut: string; when?: string }[];
}

export async function exportKeybindings(): Promise<KeybindingExport> {
  return invoke<KeybindingExport>("backup_keybindings_export");
}

export async function importKeybindings(payload: KeybindingExport): Promise<{ ok: boolean; conflicts: string[] }> {
  return invoke("backup_keybindings_import", { payload });
}
