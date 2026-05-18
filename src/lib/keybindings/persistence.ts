// S-KB-004: persist user binding overrides to <data_dir>/keybindings.json
// via the ops_keybindings_load / ops_keybindings_save Tauri commands.
//
// The on-disk shape is `{ "<commandId>": "<binding>" }`. An empty
// string means the user explicitly unbound the command (different
// from "no entry", which inherits from the preset). The front-end
// hydrates the binding store from this object on app start.

import { invoke } from "@tauri-apps/api/core";

import {
  type Binding,
  clearUserOverride,
  getPreset,
  listActiveBindings,
  setUserOverride,
  switchPreset,
} from ".";
import type { Preset } from "./types";

// `$preset` is a sentinel key co-located with the override map. We
// piggy-back on keybindings.json instead of the broader settings.json
// so the file is self-describing — one file completely captures the
// keybinding state.
const PRESET_KEY = "$preset";

type OverridesMap = Record<string, Binding>;

export async function hydrateUserOverrides(): Promise<void> {
  const raw = (await invoke("ops_keybindings_load")) as
    | (OverridesMap & { [PRESET_KEY]?: Preset })
    | null;
  if (!raw || typeof raw !== "object") return;

  // Preset is applied first so user overrides land on top of the right
  // baseline. An unknown preset (e.g. plugin uninstalled) falls back
  // to whatever was active — switchPreset already warns.
  const savedPreset = raw[PRESET_KEY];
  if (savedPreset) switchPreset(savedPreset);

  for (const [commandId, binding] of Object.entries(raw)) {
    if (commandId === PRESET_KEY) continue;
    if (binding === "") {
      // Explicit unbind survives across runs; we represent it by
      // setting the override to the empty string.
      setUserOverride(commandId, "");
    } else {
      setUserOverride(commandId, binding as Binding);
    }
  }
}

export async function persistUserOverrides(): Promise<void> {
  const out: OverridesMap & { [PRESET_KEY]?: Preset } = {};
  out[PRESET_KEY] = getPreset();
  for (const e of listActiveBindings()) {
    if (e.source === "user") out[e.commandId] = e.binding;
  }
  await invoke("ops_keybindings_save", { overrides: out });
}

/**
 * S-KB-006: switch presets and persist the choice. User overrides
 * are kept (they live in the userOverrides Map untouched) so
 * `listActiveBindings` continues to layer them on top of the new
 * preset.
 */
export async function changePreset(name: Preset): Promise<boolean> {
  const ok = switchPreset(name);
  if (ok) await persistUserOverrides();
  return ok;
}

export async function rebind(commandId: string, binding: Binding): Promise<void> {
  setUserOverride(commandId, binding);
  await persistUserOverrides();
}

export async function unbind(commandId: string): Promise<void> {
  // Use the empty-string sentinel so the override layer keeps a
  // record of the explicit unbind. clearUserOverride would let the
  // preset re-surface, which is "reset to preset" — a separate
  // action (S-KB-007).
  setUserOverride(commandId, "");
  await persistUserOverrides();
}

export async function resetToPreset(commandId: string): Promise<void> {
  clearUserOverride(commandId);
  await persistUserOverrides();
}

/**
 * S-KB-007: reset every user override back to the active preset.
 * Backs up keybindings.json → keybindings.json.bak first so a
 * panicked user can recover the previous state by copying .bak
 * back over. Returns the backup path (null on first run when
 * there was nothing to back up).
 *
 * The caller is responsible for showing a confirmation dialog —
 * this function performs the destructive action unconditionally.
 */
export async function resetAllToPreset(): Promise<string | null> {
  const backupPath = (await invoke("ops_keybindings_backup")) as string | null;
  for (const e of listActiveBindings()) {
    if (e.source === "user") clearUserOverride(e.commandId);
  }
  await persistUserOverrides();
  return backupPath;
}
