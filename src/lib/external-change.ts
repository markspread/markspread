// S-ESP-008: detect external (out-of-band) changes to a file before saving.
//
// Two panes editing the same buffer save through a single coalesced timer
// (S-ESP-007). But that timer fires after a user pause — and during that
// pause, another process (git checkout, formatter, scp, etc.) could rewrite
// the file. Saving the buffer unconditionally would silently overwrite that
// external change.
//
// `detectExternalChange` re-stats the file and compares `modified_ms` against
// the baseline captured at read time. If the timestamp moved forward (or the
// file is gone — `stat` rejects), the caller should pause the save and
// surface a notification.
//
// We deliberately use coarse mtime instead of sha256 here:
//   - sha256 means reading the whole file every save → expensive on big docs.
//   - mtime is what every other editor (VSCode, vim, IntelliJ) uses too.
//   - false positives (mtime touch without content change) just trigger a
//     toast; the user still owns the choice to overwrite.

import { invoke } from "@tauri-apps/api/core";

interface FileStat {
  path: string;
  kind: string;
  size: number;
  is_dir: boolean;
  is_file: boolean;
  readonly: boolean;
  modified_ms?: number | null;
  created_ms?: number | null;
  accessed_ms?: number | null;
}

export type ExternalChange =
  | { kind: "unchanged" }
  | { kind: "modified"; baselineMs: number; currentMs: number }
  | { kind: "deleted"; baselineMs: number | null }
  | { kind: "unknown"; reason: string };

/**
 * Compare disk state against the captured baseline mtime. Resolves with the
 * change kind; never throws — callers shouldn't need a try/catch to decide
 * whether to save.
 *
 * `baselineMs` is the mtime recorded at the time of `fs_read_file`. Pass
 * `null` for "we never recorded one" (treat as unchanged).
 */
export async function detectExternalChange(
  workspace: string,
  path: string,
  baselineMs: number | null | undefined,
): Promise<ExternalChange> {
  if (baselineMs == null) return { kind: "unchanged" };
  try {
    const stat = await invoke<FileStat>("fs_stat", { workspace, path });
    const current = stat.modified_ms ?? null;
    if (current == null) return { kind: "unchanged" };
    if (current > baselineMs) {
      return { kind: "modified", baselineMs, currentMs: current };
    }
    return { kind: "unchanged" };
  } catch (err) {
    const msg = String((err as { message?: string })?.message ?? err);
    if (/not.?found|ENOENT|No such/i.test(msg)) {
      return { kind: "deleted", baselineMs };
    }
    return { kind: "unknown", reason: msg };
  }
}
