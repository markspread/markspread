// S-OP-005: front-end wrappers for settings + keymap backup/restore.
// The on-disk format is a single JSON file the user can store
// wherever they like — we never push to a cloud service.

import { invoke } from "@tauri-apps/api/core";
import { open, save } from "@tauri-apps/plugin-dialog";
import { readTextFile, writeTextFile } from "@tauri-apps/plugin-fs";

export type SettingsBackup = {
  envelopeVersion: number;
  appVersion: string;
  generatedAtMs: number;
  payloadSha256: string;
  payload: {
    settings: unknown;
    keybindings: unknown;
    snippets: unknown | null;
  };
};

export async function exportSettingsBackup(): Promise<string | null> {
  const backup = await invoke<SettingsBackup>("ops_settings_backup");
  const filename = `markspread-settings-${new Date(backup.generatedAtMs)
    .toISOString()
    .replace(/[:.]/g, "-")}.json`;
  const path = await save({
    defaultPath: filename,
    filters: [{ name: "JSON", extensions: ["json"] }],
  });
  if (!path) return null;
  await writeTextFile(path, JSON.stringify(backup, null, 2));
  return path;
}

export async function importSettingsBackup(): Promise<boolean> {
  const path = await open({
    multiple: false,
    filters: [{ name: "JSON", extensions: ["json"] }],
  });
  if (!path || typeof path !== "string") return false;
  const raw = await readTextFile(path);
  const backup = JSON.parse(raw) as SettingsBackup;
  await invoke("ops_settings_restore", { backup });
  return true;
}
