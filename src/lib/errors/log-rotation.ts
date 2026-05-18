// S-ER-011: log file rotation.
//
// The Rust side writes structured JSONL to `~/.markspread/logs/app.log`.
// Without rotation a long-running install grows unbounded; we cap the
// active file at 5 MB and keep the last 5 rotations (`app.log.1` ..
// `app.log.5`). On overflow, files shift up by one and the oldest is
// dropped. Crash logs (separate file) follow the same rules but with a
// 2 MB cap because they're more useful in short windows.
//
// This module only exposes the configuration; the rotation itself runs
// in the Rust logger so the file ops happen on the same thread that
// owns the file handle.

import { invoke } from "@tauri-apps/api/core";

export interface LogRotationConfig {
  /** Bytes — when the active file exceeds this, rotate. */
  maxBytes: number;
  /** Number of historical files to keep, not counting the active one. */
  keep: number;
  /** Minimum interval between rotation checks, in seconds — keeps the IO cheap. */
  checkIntervalSec: number;
}

export const APP_LOG_ROTATION: LogRotationConfig = {
  maxBytes: 5 * 1024 * 1024,
  keep: 5,
  checkIntervalSec: 30,
};

export const CRASH_LOG_ROTATION: LogRotationConfig = {
  maxBytes: 2 * 1024 * 1024,
  keep: 10,
  checkIntervalSec: 30,
};

export async function applyLogRotation(): Promise<void> {
  await invoke("logger_set_rotation", {
    appLog: APP_LOG_ROTATION,
    crashLog: CRASH_LOG_ROTATION,
  });
}

// Surface the on-disk log paths to the Privacy panel so the user can
// open them with their preferred viewer. We don't render the content in
// the app — log lines can contain sensitive masking output and a 5 MB
// in-renderer view is wasteful.
export interface LogLocations {
  appLogPath: string;
  crashLogDir: string;
}

export async function logLocations(): Promise<LogLocations> {
  return invoke<LogLocations>("logger_locations");
}
