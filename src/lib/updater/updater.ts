// S-UP-001..019: in-app updater orchestration.
//
// We layer on top of the Tauri updater plugin (which handles
// platform-specific install + signature verify) with the application's
// own UX logic:
//
//   - check on launch (S-UP-001) and on schedule
//   - background download (S-UP-002), resumable across network blips
//   - progress chip, release notes dialog, Restart-and-Install button
//   - channel toggle: stable / beta (S-UP-012)
//   - install policies: auto-DL+manual-install (default), auto-both,
//     manual-only (S-UP-009/010/011/018)
//   - rollback on bad install (S-UP-017)
//   - delta updates: scoped to v2 (S-UP-019), stub here

import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import { isDowngrade, type UpdateManifest } from "../security/update-verify";

// S-REL-014: three-channel split. `stable` is the default for
// production users; `beta` is opt-in for users who want the
// pre-release tested-by-staff builds; `alpha` is internal-only and
// the channel-picker UI hides it unless the user's licence claims
// `internal: true` (set on org-issued licence keys).
export type UpdateChannel = "stable" | "beta" | "alpha";

export type InstallPolicy = "auto-download-manual-install" | "auto-both" | "manual-check";

export interface UpdaterSettings {
  enabled: boolean;        // S-UP-018
  channel: UpdateChannel;
  policy: InstallPolicy;
  /** Last successful check, epoch ms. */
  lastCheckedAt: number;
}

export const DEFAULT_UPDATER_SETTINGS: UpdaterSettings = {
  enabled: true,
  channel: "stable",
  policy: "auto-download-manual-install",
  lastCheckedAt: 0,
};

export type UpdaterState =
  | { kind: "idle" }
  | { kind: "checking" }
  | { kind: "available"; manifest: UpdateManifest }
  | { kind: "downloading"; manifest: UpdateManifest; bytesPulled: number; totalBytes: number }
  | { kind: "ready"; manifest: UpdateManifest; installerPath: string }
  | { kind: "installing"; manifest: UpdateManifest }
  | { kind: "rolledBack"; manifest: UpdateManifest; reason: string } // S-UP-017
  | { kind: "error"; code: string; message: string };

export async function checkForUpdate(channel: UpdateChannel): Promise<UpdateManifest | null> {
  return invoke<UpdateManifest | null>("updater_check", { channel });
}

export async function startDownload(manifest: UpdateManifest): Promise<void> {
  await invoke("updater_download", { manifest });
}

export async function cancelDownload(): Promise<void> {
  await invoke("updater_cancel");
}

export async function installAndRestart(): Promise<void> {
  await invoke("updater_install_and_restart");
}

// Subscribe to the Rust-side progress stream. The handler receives
// progress events at ~10Hz; we throttle UI updates separately if needed.
export interface DownloadProgress {
  bytesPulled: number;
  totalBytes: number;
  /** Network failures get coalesced into a `paused` state with a backoff timer. */
  paused: boolean;
  /** Resumable: the Rust side keeps the partial file across restarts. */
  resumable: boolean;
}

export function subscribeToProgress(handler: (p: DownloadProgress) => void): Promise<UnlistenFn> {
  return listen<DownloadProgress>("updater://progress", (e) => handler(e.payload));
}

// S-UP-013: security patch flagging. The manifest has a boolean
// `securityCritical`; when true, the toast that appears is non-dismissable
// for 30 seconds and the dialog copy is more emphatic.
export interface SecurityFlag {
  critical: boolean;
  cveIds: string[];
}

export function manifestSecurityFlag(manifest: UpdateManifest): SecurityFlag | null {
  // Tag convention: release notes start with `## Security` and embed
  // any CVEs as inline links. Rust side parses this once.
  const hasSecurityTag = /^##\s+security/im.test(manifest.notesMarkdown);
  if (!hasSecurityTag) return null;
  const cveIds = [...manifest.notesMarkdown.matchAll(/CVE-\d{4}-\d{4,7}/g)].map((m) => m[0]);
  return { critical: true, cveIds };
}

// S-UP-016: pre-flight rejection of older versions. The user can ask to
// revert via Settings → Update → Reinstall older version, but the
// background updater never proposes it on its own.
export function shouldOfferUpdate(currentVersion: string, manifest: UpdateManifest): boolean {
  return !isDowngrade(currentVersion, manifest.version);
}

// S-UP-019: delta updates. Stub for the v2 build that introduces
// bsdiff-based patches. Today the manifest carries the full installer URL.
export interface DeltaPatchInfo {
  fromVersion: string;
  toVersion: string;
  url: string;
  sha256: string;
  size: number;
}

export function selectDelta(_manifest: UpdateManifest, _current: string): DeltaPatchInfo | null {
  return null;
}
