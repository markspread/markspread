// S-KB-006: preset registry + switching API. v1 ships only the
// VSCode preset built-in. Sublime / Vim presets are explicitly out
// of scope for the host and will arrive through the plugin system
// (S-KB-012) — a plugin can register a complete preset by setting
// source: "plugin" entries for every command.
//
// Switching a preset preserves user overrides: the persistence
// layer (S-KB-004) keeps overrides separate, so the reload after
// preset change re-applies them on top.

import type { BindingEntry, Preset } from "../types";
import { vscodePreset } from "./vscode";

const presets = new Map<Preset, BindingEntry[]>([
  ["vscode", vscodePreset],
  // The "none" preset is empty: the user starts with a blank slate
  // and adds bindings from the keybinding sheet. Useful for
  // accessibility setups where stock chords clash with assistive
  // tech.
  ["none", []],
]);

export function listPresets(): Preset[] {
  return [...presets.keys()];
}

export function getPresetEntries(name: Preset): BindingEntry[] | null {
  return presets.get(name) ?? null;
}

/**
 * Plugin-registered presets. v1 has none built-in; the marketplace
 * Sublime / Vim plugins call this on activation. We do not persist
 * the registration — re-registration on plugin load keeps the
 * registry in sync with what's actually installed.
 */
export function registerPluginPreset(name: Preset, entries: BindingEntry[]): void {
  presets.set(
    name,
    entries.map((e) => ({ ...e, source: "plugin" })),
  );
}
