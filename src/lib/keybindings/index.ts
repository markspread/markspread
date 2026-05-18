// S-KB-001: keybinding store + resolution. The store layers user
// overrides on top of the active preset; user always wins. Plugin
// bindings come from the plugin manifest at install time and act like
// a third layer between preset and user (S-KB-012).
//
// The store does not register OS event listeners by itself — that's
// the editor's job (CodeMirror keymap) for in-editor shortcuts and
// the global window listener for modeless ones (S-KB-010). Both
// callers ask `resolveBinding(event)` to map a KeyboardEvent to a
// command id.

import type { Binding, BindingEntry, Preset } from "./types";
import { vscodePreset } from "./presets/vscode";
import { getPresetEntries } from "./presets";

export type { Binding, BindingEntry, Preset } from "./types";

const isMac =
  typeof navigator !== "undefined" &&
  /Mac|iPhone|iPad/i.test(navigator.platform || navigator.userAgent || "");

let activePreset: Preset = "vscode";
let presetEntries: BindingEntry[] = vscodePreset;
const userOverrides = new Map<string /*commandId*/, Binding>();
let pluginEntries: BindingEntry[] = [];

export function setPreset(preset: Preset, entries: BindingEntry[]): void {
  activePreset = preset;
  presetEntries = entries;
}

export function getPreset(): Preset {
  return activePreset;
}

/**
 * S-KB-006: switch the active preset by name. User overrides are
 * intentionally untouched — `listActiveBindings` keeps layering them on
 * top, so a Mod+K Mod+S a user picked still wins after switching from
 * vscode to a Sublime plugin preset.
 *
 * Returns true if the preset is registered. Unknown names are a no-op
 * with a warning so a stale settings.json (e.g. user uninstalled the
 * Vim plugin) doesn't blank out the bindings.
 */
export function switchPreset(name: Preset): boolean {
  const entries = getPresetEntries(name);
  if (!entries) {
    console.warn(`[keybindings] unknown preset '${name}', staying on '${activePreset}'`);
    return false;
  }
  setPreset(name, entries);
  return true;
}

export function setUserOverride(commandId: string, binding: Binding): void {
  userOverrides.set(commandId, normaliseBinding(binding));
}

export function clearUserOverride(commandId: string): void {
  userOverrides.delete(commandId);
}

/**
 * S-KB-012: a plugin contributes its keybindings on activation. Each
 * entry is tagged with the plugin id so we can drop just that plugin's
 * mappings on deactivation. The user's overrides for plugin commands
 * live in the same userOverrides Map as for built-in commands and
 * survive activation/deactivation cycles — when the plugin re-loads
 * the override re-applies on top.
 *
 * Re-registering an already-registered plugin replaces its entries
 * (i.e. an upgrade-in-place doesn't accumulate duplicates).
 */
export function registerPluginKeybindings(
  pluginId: string,
  entries: { commandId: string; binding: Binding }[],
): void {
  pluginEntries = pluginEntries.filter((e) => e.pluginId !== pluginId);
  for (const e of entries) {
    pluginEntries.push({
      commandId: e.commandId,
      binding: normaliseBinding(e.binding),
      source: "plugin",
      pluginId,
    });
  }
}

/**
 * Drop every binding contributed by the given plugin. User overrides
 * for those commands are intentionally kept — the user may have
 * customised them and we don't want a re-install to silently revert.
 */
export function unregisterPluginKeybindings(pluginId: string): void {
  pluginEntries = pluginEntries.filter((e) => e.pluginId !== pluginId);
}

export function listActiveBindings(): BindingEntry[] {
  const out = new Map<string, BindingEntry>();
  for (const e of presetEntries) out.set(e.commandId, e);
  for (const e of pluginEntries) out.set(e.commandId, e);
  for (const [id, binding] of userOverrides) {
    out.set(id, { commandId: id, binding, source: "user" });
  }
  return [...out.values()];
}

/**
 * Translate a Binding ("Mod+S", "Mod+Shift+P", or a chord like
 * "Mod+K Mod+W") into a canonical, sortable string. Both the preset
 * author and the keydown handler call this; equal bindings produce
 * equal strings.
 */
export function normaliseBinding(binding: Binding): Binding {
  return binding
    .split(/\s+/)
    .map(normaliseStep)
    .join(" ");
}

function normaliseStep(step: string): string {
  const parts = step.split("+").map((p) => p.trim()).filter(Boolean);
  const order = ["Mod", "Ctrl", "Alt", "Shift"];
  const mods = parts
    .filter((p) => order.includes(p))
    .sort((a, b) => order.indexOf(a) - order.indexOf(b));
  const keyParts = parts.filter((p) => !order.includes(p));
  if (keyParts.length === 0) return mods.join("+");
  return [...mods, keyParts.join("+")].join("+");
}

/**
 * Build a binding string from a KeyboardEvent. The Mod modifier is
 * Cmd on macOS (event.metaKey) and Ctrl elsewhere (event.ctrlKey).
 *
 * We use event.code (e.g. "KeyS", "Slash", "ArrowUp") rather than
 * event.key so the binding survives non-QWERTY layouts (S-KB-002).
 */
export function bindingFromEvent(event: KeyboardEvent): Binding {
  const mods: string[] = [];
  const cmd = isMac ? event.metaKey : event.ctrlKey;
  if (cmd) mods.push("Mod");
  if (!isMac && event.metaKey) mods.push("Meta");
  if (event.ctrlKey && isMac) mods.push("Ctrl"); // Ctrl is meaningful as a separate modifier on Mac
  if (event.altKey) mods.push("Alt");
  if (event.shiftKey) mods.push("Shift");

  const key = codeToBinding(event.code, event.key);
  if (!key) return "";
  return [...mods, key].join("+");
}

function codeToBinding(code: string, fallbackKey: string): string {
  if (!code) return fallbackKey;
  if (code.startsWith("Key")) return code.slice(3); // KeyA → A
  if (code.startsWith("Digit")) return code.slice(5); // Digit1 → 1
  switch (code) {
    case "Slash": return "/";
    case "Backslash": return "\\";
    case "Backquote": return "`";
    case "Minus": return "-";
    case "Equal": return "=";
    case "Comma": return ",";
    case "Period": return ".";
    case "Semicolon": return ";";
    case "Quote": return "'";
    case "BracketLeft": return "[";
    case "BracketRight": return "]";
    case "Space": return "Space";
    case "Enter": return "Enter";
    case "Tab": return "Tab";
    case "Escape": return "Escape";
    case "Backspace": return "Backspace";
    case "Delete": return "Delete";
    case "ArrowUp": return "ArrowUp";
    case "ArrowDown": return "ArrowDown";
    case "ArrowLeft": return "ArrowLeft";
    case "ArrowRight": return "ArrowRight";
    default:
      if (code.startsWith("F") && /^F\d+$/.test(code)) return code; // F1..F12
      return fallbackKey;
  }
}

/**
 * Find the command id bound to the given KeyboardEvent. Returns null
 * if no binding matches. Caller is responsible for the `when` clause
 * (active editor / dialog / etc.).
 *
 * Chord bindings (e.g. "Mod+K Mod+W") are handled by the editor host:
 * after a chord prefix is matched, the host calls `resolveBinding`
 * again with the next event and a `prefix` argument. See S-KB-009.
 */
export function resolveBinding(event: KeyboardEvent, prefix?: Binding): string | null {
  const step = normaliseStep(bindingFromEvent(event));
  if (!step) return null;
  const want = prefix ? `${prefix} ${step}` : step;
  for (const entry of listActiveBindings()) {
    if (normaliseBinding(entry.binding) === want) return entry.commandId;
  }
  return null;
}

/**
 * Pretty-print a binding for the keybinding sheet (S-KB-003). On
 * macOS, "Mod" renders as ⌘; elsewhere as Ctrl.
 */
export function formatBinding(binding: Binding): string {
  if (!binding) return "";
  return binding
    .split(/\s+/)
    .map((step) =>
      step
        .split("+")
        .map((p) => {
          if (p === "Mod") return isMac ? "⌘" : "Ctrl";
          if (p === "Ctrl") return isMac ? "⌃" : "Ctrl";
          if (p === "Alt") return isMac ? "⌥" : "Alt";
          if (p === "Shift") return isMac ? "⇧" : "Shift";
          if (p === "Meta") return isMac ? "⌘" : "Win";
          if (p === "ArrowUp") return "↑";
          if (p === "ArrowDown") return "↓";
          if (p === "ArrowLeft") return "←";
          if (p === "ArrowRight") return "→";
          if (p === "Enter") return "↵";
          if (p === "Escape") return "Esc";
          return p;
        })
        .join(isMac ? "" : "+"),
    )
    .join(" ");
}
