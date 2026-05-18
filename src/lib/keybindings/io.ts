// S-KB-011: import / export the user's keybinding overrides as a
// JSON file the user can copy between machines or share.
//
// The on-disk shape is the same as keybindings.json without the
// internal "$preset" sentinel — just `{ commandId: binding }`. We keep
// the format minimal so a user can hand-edit the file without a
// schema reference, and we tag it with a tiny header at the top of
// the file via JSON-with-comments? No — JSON proper, no comments.
// Instead we drop a `$schema` URL pointer (front-end ignores it on
// import) so editors with JSON intellisense pick it up.
//
// Acceptance:
//   • Command palette "Export Keybindings" → JSON file picker
//   • Import with conflict handling: "merge" (incoming wins on overlap)
//     or "replace" (drops every existing user override first).

import { open as openDialog, save as saveDialog } from "@tauri-apps/plugin-dialog";
import { readTextFile, writeTextFile } from "@tauri-apps/plugin-fs";

import type { Binding, BindingEntry } from "./types";
import {
  clearUserOverride,
  listActiveBindings,
  setUserOverride,
} from ".";
import { persistUserOverrides } from "./persistence";

const SCHEMA_URL = "https://markspread.app/schemas/keybindings.json";

type ExportFile = {
  $schema?: string;
  bindings: Record<string, Binding>;
};

export async function exportKeybindings(): Promise<string | null> {
  const path = await saveDialog({
    title: "Export Keybindings",
    defaultPath: "markspread-keybindings.json",
    filters: [{ name: "JSON", extensions: ["json"] }],
  });
  if (!path) return null;

  const bindings: Record<string, Binding> = {};
  for (const e of listActiveBindings()) {
    if (e.source === "user") bindings[e.commandId] = e.binding;
  }
  const payload: ExportFile = { $schema: SCHEMA_URL, bindings };
  await writeTextFile(path, JSON.stringify(payload, null, 2));
  return path;
}

export type ImportMode = "merge" | "replace";

export type ImportReport = {
  applied: number;
  skipped: number;
  conflicts: { commandId: string; existing: Binding; incoming: Binding }[];
};

/**
 * Read a keybindings JSON file and apply it. In "merge" mode, the
 * incoming bindings overwrite overlapping entries — same semantics as
 * pasting them into the keybinding sheet one by one. In "replace"
 * mode, every existing user override is cleared first, so the file
 * becomes the user's complete set.
 *
 * Returns a report so the caller can surface what changed.
 */
export async function importKeybindings(
  mode: ImportMode = "merge",
): Promise<ImportReport | null> {
  const path = await openDialog({
    title: "Import Keybindings",
    multiple: false,
    filters: [{ name: "JSON", extensions: ["json"] }],
  });
  if (!path || Array.isArray(path)) return null;

  const raw = await readTextFile(path);
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (e) {
    throw new Error(`Invalid JSON: ${e instanceof Error ? e.message : String(e)}`);
  }
  const bindings = extractBindings(parsed);
  if (!bindings) {
    throw new Error(
      "File is not a Markspread keybindings export (missing bindings object).",
    );
  }

  const existing = new Map<string, BindingEntry>();
  for (const e of listActiveBindings()) {
    if (e.source === "user") existing.set(e.commandId, e);
  }

  if (mode === "replace") {
    for (const id of existing.keys()) clearUserOverride(id);
    existing.clear();
  }

  const report: ImportReport = { applied: 0, skipped: 0, conflicts: [] };
  for (const [commandId, binding] of Object.entries(bindings)) {
    const prior = existing.get(commandId);
    if (prior && prior.binding !== binding) {
      report.conflicts.push({
        commandId,
        existing: prior.binding,
        incoming: binding,
      });
    }
    setUserOverride(commandId, binding);
    report.applied++;
  }

  await persistUserOverrides();
  return report;
}

function extractBindings(value: unknown): Record<string, Binding> | null {
  if (!value || typeof value !== "object") return null;
  const obj = value as Record<string, unknown>;
  // Tolerate a flat shape (just `{ commandId: binding }`) too — that's
  // what older drafts and copy-paste snippets look like.
  if (obj.bindings && typeof obj.bindings === "object") {
    return coerce(obj.bindings as Record<string, unknown>);
  }
  return coerce(obj);
}

function coerce(map: Record<string, unknown>): Record<string, Binding> | null {
  const out: Record<string, Binding> = {};
  for (const [k, v] of Object.entries(map)) {
    if (k === "$schema") continue;
    if (typeof v !== "string") return null;
    out[k] = v;
  }
  return out;
}
