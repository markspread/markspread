// S-OP-004: pull a redacted diagnostics bundle from the host. The
// front-end shows it in a reviewable text area first; only on user
// confirm does it write to disk via Tauri's dialog plugin.

import { invoke } from "@tauri-apps/api/core";
import { save } from "@tauri-apps/plugin-dialog";
import { writeTextFile } from "@tauri-apps/plugin-fs";

export type DiagnosticsBundle = {
  generatedAtMs: number;
  appVersion: string;
  os: string;
  osArch: string;
  portable: boolean;
  dataDir: string;
  settings: unknown;
  recentLogLines: string[];
  notes: string[];
};

export async function fetchDiagnostics(): Promise<DiagnosticsBundle> {
  return invoke<DiagnosticsBundle>("ops_export_diagnostics");
}

export async function saveDiagnostics(bundle: DiagnosticsBundle): Promise<string | null> {
  const filename = `markspread-diagnostics-${new Date(bundle.generatedAtMs)
    .toISOString()
    .replace(/[:.]/g, "-")}.json`;
  const path = await save({
    defaultPath: filename,
    filters: [{ name: "JSON", extensions: ["json"] }],
  });
  if (!path) return null;
  await writeTextFile(path, JSON.stringify(bundle, null, 2));
  return path;
}
