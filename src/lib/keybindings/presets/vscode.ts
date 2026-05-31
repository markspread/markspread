// S-KB-001: VSCode-style preset. This is the default that ships on
// first run. Every entry maps a stable command id (see
// src/lib/commands/registry.ts) to a normalised binding string.
//
// "Mod" is Cmd on macOS, Ctrl on Windows/Linux — resolved when the
// keydown handler matches an event. Keys use KeyboardEvent.code names
// so the binding survives non-QWERTY layouts (S-KB-002).
//
// Adding a row here: keep it sorted by command id. If a command does
// not have a binding, omit it — empty string would imply "explicitly
// unbound" which the user-override layer treats as a real assignment.
//
// IMPORTANT — invariant (M16): every entry MUST reference a command id
// that is either:
//   1. Registered in `src/lib/commands/registry.ts`, OR
//   2. Listed in `./codemirror-passthrough.ts` as a CodeMirror-handled
//      shortcut surfaced only for keybinding-sheet discoverability.
// The preset-coverage test in `__tests__/index.test.ts` enforces this.
// Anything else silently fails when the user presses the key.

import type { BindingEntry } from "../types";

export const vscodePreset: BindingEntry[] = [
  // File / workspace
  { commandId: "filetree.new_file", binding: "Mod+N", source: "preset" },
  { commandId: "filetree.new_folder", binding: "Mod+Shift+N", source: "preset" },
  { commandId: "filetree.toggle_hidden", binding: "Mod+Alt+.", source: "preset" },
  { commandId: "workspace.close", binding: "Mod+K Mod+W", source: "preset" },
  { commandId: "workspace.open", binding: "Mod+K Mod+O", source: "preset" },
  { commandId: "workspace.switch", binding: "Mod+K Mod+R", source: "preset" },
  { commandId: "workspace.locate", binding: "Mod+K Mod+L", source: "preset" },
  { commandId: "window.new", binding: "Mod+Shift+W", source: "preset" },

  // Edit basics — CodeMirror provides these via defaultKeymap /
  // historyKeymap / searchKeymap inside the editor. They live in the
  // preset purely so the keybinding sheet (S-KB-003) can advertise
  // them; the global dispatcher skips them because no host command is
  // registered, and CodeMirror's own keymap fires while the editor is
  // focused.
  { commandId: "edit.save", binding: "Mod+S", source: "preset" },
  { commandId: "edit.undo", binding: "Mod+Z", source: "preset" },
  { commandId: "edit.redo", binding: "Mod+Shift+Z", source: "preset" },
  { commandId: "edit.find", binding: "Mod+F", source: "preset" },
  { commandId: "edit.find_replace", binding: "Mod+Alt+F", source: "preset" },
  { commandId: "edit.go_to_line", binding: "Mod+G", source: "preset" },
  { commandId: "edit.duplicate_line", binding: "Mod+Shift+D", source: "preset" },
  { commandId: "edit.delete_line", binding: "Mod+Shift+K", source: "preset" },
  { commandId: "edit.move_line_up", binding: "Alt+ArrowUp", source: "preset" },
  { commandId: "edit.move_line_down", binding: "Alt+ArrowDown", source: "preset" },
  { commandId: "edit.copy_line_up", binding: "Shift+Alt+ArrowUp", source: "preset" },
  { commandId: "edit.copy_line_down", binding: "Shift+Alt+ArrowDown", source: "preset" },
  { commandId: "edit.toggle_comment", binding: "Mod+/", source: "preset" },

  // View / panels
  { commandId: "tabs.close_active", binding: "Mod+W", source: "preset" },
  { commandId: "view.toggle_sidebar", binding: "Mod+B", source: "preset" },
  { commandId: "view.peek_sidebar", binding: "Mod+Shift+E", source: "preset" },
  { commandId: "view.split_right", binding: "Mod+\\", source: "preset" },
  { commandId: "view.split_down", binding: "Mod+K Mod+\\", source: "preset" },
  { commandId: "view.focus_pane_1", binding: "Mod+1", source: "preset" },
  { commandId: "view.focus_pane_2", binding: "Mod+2", source: "preset" },
  { commandId: "view.focus_pane_3", binding: "Mod+3", source: "preset" },

  // AI
  { commandId: "ai.palette.open", binding: "Mod+.", source: "preset" },
];

// Note: Mod+B (view.toggle_sidebar) and Mod+/ (edit.toggle_comment)
// are also pressed inside the editor for md.bold / md.comment-like
// gestures, but those are CodeMirror-side bindings layered on the
// editor's own keymap — not host commands. The dispatcher's
// specific-wins-over-always rule routes Mod+B to the sidebar
// outside the editor; inside the editor CodeMirror sees the event
// first because the editor's keymap binds at higher precedence than
// the global window listener (S-KB-005, S-KB-010).
