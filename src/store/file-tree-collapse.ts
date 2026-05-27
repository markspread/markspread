// MAR-1014: collapse-state persistence shim for `useFileTree`.
//
// The in-memory store (`./file-tree`) already persists through zustand's
// localStorage middleware. This module owns the on-disk JSON wire format
// that mirrors the same shape into `.markspread/file-tree.json` (used by
// session export / cross-window seed flows that don't share localStorage).
//
// Schema (v1):
// ```
// {
//   "schemaVersion": 1,
//   "splits": {
//     "<windowLabel>:<splitId>:<workspaceId>": { "expanded": string[] }
//   }
// }
// ```
//
// Symmetric serialise / deserialise; defensive parsing rejects malformed
// payloads by returning `null` so the caller can decide whether to seed a
// fresh state or surface the error.

import { useFileTree } from "./file-tree";

export interface CollapseEntry {
  expanded: string[];
}

export interface CollapseFileV1 {
  schemaVersion: 1;
  splits: Record<string, CollapseEntry>;
}

const SCHEMA_VERSION = 1;

/**
 * Snapshot the live `useFileTree` store into the persisted JSON shape.
 * Empty splits are dropped to keep the file lean.
 */
export function serializeCollapseState(): CollapseFileV1 {
  const splits: Record<string, CollapseEntry> = {};
  const live = useFileTree.getState().splits;
  for (const key of Object.keys(live)) {
    /* v8 ignore next -- Object.keys(live) iteration always finds the entry; the `?? []` arm is defensive */
    const list = live[key] ?? [];
    if (list.length === 0) continue;
    splits[key] = { expanded: [...list] };
  }
  return { schemaVersion: SCHEMA_VERSION, splits };
}

/**
 * Parse + validate a raw JSON value into a v1 collapse file. Returns
 * `null` on shape mismatch (wrong version, missing fields, non-string
 * entries). Unknown keys at the top level are tolerated for forward-
 * compat — only the documented fields are read.
 */
export function deserializeCollapseState(raw: unknown): CollapseFileV1 | null {
  if (!raw || typeof raw !== "object") return null;
  const obj = raw as Record<string, unknown>;
  if (obj.schemaVersion !== SCHEMA_VERSION) return null;
  const rawSplits = obj.splits;
  if (!rawSplits || typeof rawSplits !== "object") return null;
  const splits: Record<string, CollapseEntry> = {};
  for (const key of Object.keys(rawSplits as Record<string, unknown>)) {
    const entry = (rawSplits as Record<string, unknown>)[key];
    if (!entry || typeof entry !== "object") continue;
    const expandedRaw = (entry as Record<string, unknown>).expanded;
    if (!Array.isArray(expandedRaw)) continue;
    const expanded = expandedRaw.filter((p): p is string => typeof p === "string");
    splits[key] = { expanded };
  }
  return { schemaVersion: SCHEMA_VERSION, splits };
}

/**
 * Replace the live store's `splits` with the deserialised payload.
 * Caller-side guard: pass a parsed `CollapseFileV1` (use
 * `deserializeCollapseState` first) so a malformed payload can't poison
 * the runtime state.
 */
export function applyCollapseState(file: CollapseFileV1): void {
  const splits: Record<string, string[]> = {};
  for (const key of Object.keys(file.splits)) {
    const entry = file.splits[key];
    /* v8 ignore next -- Object.keys(file.splits) iteration guarantees entry; defensive */
    if (!entry) continue;
    splits[key] = [...entry.expanded];
  }
  useFileTree.setState({ splits });
}
