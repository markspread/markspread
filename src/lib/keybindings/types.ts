// S-KB-001: shared types for the keybinding system.

/**
 * A normalised binding string, e.g. "Mod+S", "Mod+Shift+P", "Ctrl+`".
 *
 * - "Mod" is Cmd on macOS, Ctrl elsewhere — resolved at match time.
 * - Modifier order is canonical: Mod, Ctrl, Alt, Shift, then the key.
 *   The preset-author writes them in any order; `normaliseBinding`
 *   sorts them so equality is a string compare.
 * - Keys use KeyboardEvent.code-style names so the binding is
 *   layout-independent (S-KB-002). For human-friendly display we
 *   render via `formatBinding` separately.
 */
export type Binding = string;

export interface BindingEntry {
  commandId: string;
  binding: Binding;
  /** "preset" entries may be overridden; "user" entries always win. */
  source: "preset" | "user" | "plugin";
  /**
   * S-KB-012: plugin owner for `source: "plugin"` entries. Used at
   * uninstall time to drop only that plugin's bindings while leaving
   * the user's overrides (which the user may now want to apply to a
   * different command) intact.
   */
  pluginId?: string;
}

export type Preset = "vscode" | "sublime" | "vim" | "none";
