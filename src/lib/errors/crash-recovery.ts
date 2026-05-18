// S-ER-008 / S-ER-013: crash recovery + opt-in crash reporter.
//
// We persist a "session beacon" every few seconds with the current
// document hash + dirty flag. On startup, if a beacon exists from a
// session that didn't shut down cleanly, we offer to restore unsaved
// edits. The beacon lives in `~/.markspread/state/last-session.json`
// and is cleared on clean exit.
//
// Sentry-style telemetry is opt-in (S-TELEMETRY-* covers the consent
// surface); when opted in, the on-crash hook posts a sanitised payload
// (no document text, no paths, no env keys — only the structured stack
// + error code + version).

import { invoke } from "@tauri-apps/api/core";

export interface SessionBeacon {
  /** Session id — uuid generated at app start. */
  id: string;
  /** Per-tab unsaved buffers; key is the document path or `untitled-N`. */
  buffers: { key: string; dirty: boolean; sha256: string; bytes: number }[];
  /** When the beacon was last refreshed. */
  ts: number;
}

export const BEACON_REFRESH_INTERVAL_MS = 5_000;

export async function writeBeacon(beacon: SessionBeacon): Promise<void> {
  await invoke("error_session_beacon_write", { beacon });
}

export async function readBeacon(): Promise<SessionBeacon | null> {
  return invoke<SessionBeacon | null>("error_session_beacon_read");
}

export async function clearBeacon(): Promise<void> {
  await invoke("error_session_beacon_clear");
}

// Recovery prompt: returns the buffers we believe were unsaved at crash
// time. Restored buffers are matched by sha256 against the on-disk
// version — when they match, the dirty flag was a false alarm and we
// silently drop the entry.
export interface RecoveryCandidate {
  key: string;
  bytes: number;
  /** Resolved on-disk content if available, so we can show a diff before the user accepts. */
  diskBody: string | null;
  /** Buffer body recovered from the autosave file, if we kept one. */
  recoveredBody: string | null;
}

export async function listRecoveryCandidates(): Promise<RecoveryCandidate[]> {
  return invoke<RecoveryCandidate[]>("error_recovery_list");
}

// S-ER-013: crash reporter payload. The Rust side fills in build/version
// metadata; the renderer fills in the user-action context (last 50
// breadcrumbs — keystrokes are NOT recorded, only command-palette / menu
// activations and high-level state transitions like "opened workspace").
// Data is stripped of paths / file contents before being sent.
export interface CrashReport {
  errorCode: string;
  message: string;
  stack: string | null;
  buildVersion: string;
  platform: "macos" | "windows" | "linux";
  breadcrumbs: Breadcrumb[];
  /** True only when the user has opted in via Settings → Privacy. */
  consentGranted: boolean;
}

export interface Breadcrumb {
  ts: number;
  category: "command" | "navigation" | "settings" | "lifecycle";
  /** The label string is *static* — never includes filenames or selection text. */
  label: string;
}

export const BREADCRUMB_RING_SIZE = 50;

export class BreadcrumbRing {
  private items: Breadcrumb[] = [];

  push(b: Breadcrumb): void {
    this.items.push(b);
    if (this.items.length > BREADCRUMB_RING_SIZE) this.items.shift();
  }

  snapshot(): Breadcrumb[] {
    return [...this.items];
  }

  clear(): void {
    this.items = [];
  }
}

export const breadcrumbs = new BreadcrumbRing();
