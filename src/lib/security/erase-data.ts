// S-SE-022..029: Erase All Data flow.
//
// One-click "leave Markspread cleanly" path. Walks every place we
// persist state and removes it, optionally including the workspace's
// `.markspread/` folder. The flow is deliberately deliberate: a
// confirmation textbox requires the user to type the literal word
// `ERASE` (S-SE-028), and the result page lists exactly what was
// touched (S-SE-029).
//
// Self-uninstall is platform-specific:
//   - macOS: move the .app to ~/.Trash, kill the running process
//   - Windows: write a `.cmd` to the user's TEMP that waits for the
//     process to exit, then deletes the install folder
//   - Linux: same trick via a tiny shell script in /tmp
// We never auto-uninstall — it's an opt-in checkbox on the erase
// dialog.

import { invoke } from "@tauri-apps/api/core";

export interface EraseOptions {
  /** Always wipes ~/.markspread (config, AI history, plugins). */
  wipeAppData: true;
  /** S-SE-024: also wipe the workspace's .markspread/ folder. */
  wipeWorkspaceState: boolean;
  /** S-SE-022: enumerate the OS keychain and remove every Markspread item. */
  wipeKeychain: boolean;
  /** S-SE-025/026/027: trigger platform-specific self-uninstall after wipe. */
  selfUninstall: boolean;
}

export interface EraseReport {
  /** Items removed, grouped by source for the result page. */
  appDataRemoved: { path: string; bytes: number }[];
  workspaceStateRemoved: { path: string; bytes: number }[];
  keychainItemsRemoved: { alias: string }[];
  /** Anything we hit that we couldn't remove — surfaced so the user can clean up manually. */
  errors: { path: string; reason: string }[];
  /** When `selfUninstall` was selected, the platform-specific status. */
  selfUninstall: SelfUninstallStatus | null;
  totalBytesRemoved: number;
  startedAt: number;
  finishedAt: number;
}

export interface SelfUninstallStatus {
  platform: "macos" | "windows" | "linux";
  scheduled: boolean;
  /** Path to the post-exit cleanup script (Win/Linux) or the moved bundle (macOS). */
  artifact: string | null;
  /** Human-readable next-step ("Markspread will exit in 5s", etc.). */
  message: string;
}

// S-SE-028: confirmation token. The dialog requires the user to type
// the constant string below — case-sensitive, no quotes.
export const ERASE_CONFIRMATION_TOKEN = "ERASE";

export function isConfirmationValid(input: string): boolean {
  return input === ERASE_CONFIRMATION_TOKEN;
}

export async function eraseAllData(opts: EraseOptions): Promise<EraseReport> {
  return invoke<EraseReport>("security_erase_all_data", { opts });
}

// Pretty-print summary used on the post-erase result screen.
export function summariseReport(r: EraseReport): { label: string; detail: string }[] {
  const out: { label: string; detail: string }[] = [];
  if (r.appDataRemoved.length > 0) {
    out.push({ label: "App data", detail: `${r.appDataRemoved.length} files (${formatBytes(sum(r.appDataRemoved))})` });
  }
  if (r.workspaceStateRemoved.length > 0) {
    out.push({ label: "Workspace state", detail: `${r.workspaceStateRemoved.length} files (${formatBytes(sum(r.workspaceStateRemoved))})` });
  }
  if (r.keychainItemsRemoved.length > 0) {
    out.push({ label: "Keychain", detail: `${r.keychainItemsRemoved.length} aliases removed` });
  }
  if (r.errors.length > 0) {
    out.push({ label: "Could not remove", detail: `${r.errors.length} items — see report below` });
  }
  if (r.selfUninstall) {
    out.push({ label: "Self-uninstall", detail: r.selfUninstall.message });
  }
  return out;
}

function sum(items: { bytes: number }[]): number {
  return items.reduce((a, b) => a + b.bytes, 0);
}

function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  const units = ["KB","MB","GB","TB"];
  let v = n / 1024;
  let i = 0;
  while (v >= 1024 && i < units.length - 1) { v /= 1024; i += 1; }
  return `${v.toFixed(1)} ${units[i]}`;
}
