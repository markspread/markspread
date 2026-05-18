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

  // Edit basics (CodeMirror handles Mod+Z/Y/X/C/V natively; listed for
  // discoverability in the keybinding sheet)
  { commandId: "edit.save", binding: "Mod+S", source: "preset" },
  { commandId: "edit.save_all", binding: "Mod+K S", source: "preset" },
  { commandId: "edit.undo", binding: "Mod+Z", source: "preset" },
  { commandId: "edit.redo", binding: "Mod+Shift+Z", source: "preset" },
  { commandId: "edit.find", binding: "Mod+F", source: "preset" },
  { commandId: "edit.find_replace", binding: "Mod+Alt+F", source: "preset" },
  { commandId: "edit.find_in_workspace", binding: "Mod+Shift+F", source: "preset" },
  { commandId: "edit.go_to_line", binding: "Mod+G", source: "preset" },
  { commandId: "edit.duplicate_line", binding: "Mod+Shift+D", source: "preset" },
  { commandId: "edit.delete_line", binding: "Mod+Shift+K", source: "preset" },
  { commandId: "edit.move_line_up", binding: "Alt+ArrowUp", source: "preset" },
  { commandId: "edit.move_line_down", binding: "Alt+ArrowDown", source: "preset" },
  { commandId: "edit.copy_line_up", binding: "Shift+Alt+ArrowUp", source: "preset" },
  { commandId: "edit.copy_line_down", binding: "Shift+Alt+ArrowDown", source: "preset" },
  { commandId: "edit.toggle_comment", binding: "Mod+/", source: "preset" },

  // Navigation
  { commandId: "nav.go_to_file", binding: "Mod+P", source: "preset" },
  { commandId: "nav.go_to_symbol", binding: "Mod+Shift+O", source: "preset" },
  { commandId: "nav.go_back", binding: "Mod+Alt+ArrowLeft", source: "preset" },
  { commandId: "nav.go_forward", binding: "Mod+Alt+ArrowRight", source: "preset" },

  // Command palette
  { commandId: "palette.show", binding: "Mod+Shift+P", source: "preset" },
  { commandId: "palette.show_alt", binding: "F1", source: "preset" },
  { commandId: "palette.show_recent", binding: "Mod+R", source: "preset" },

  // View / panels
  { commandId: "tabs.close_active", binding: "Mod+W", source: "preset" },
  { commandId: "view.toggle_sidebar", binding: "Mod+B", source: "preset" },
  { commandId: "view.peek_sidebar", binding: "Mod+Shift+E", source: "preset" },
  { commandId: "view.split_right", binding: "Mod+\\", source: "preset" },
  { commandId: "view.split_down", binding: "Mod+K Mod+\\", source: "preset" },
  { commandId: "view.focus_pane_1", binding: "Mod+1", source: "preset" },
  { commandId: "view.focus_pane_2", binding: "Mod+2", source: "preset" },
  { commandId: "view.focus_pane_3", binding: "Mod+3", source: "preset" },
  { commandId: "view.toggle_spread_pane", binding: "Mod+Shift+V", source: "preset" },
  { commandId: "view.toggle_zen", binding: "Mod+K Z", source: "preset" },
  { commandId: "view.toggle_terminal", binding: "Ctrl+`", source: "preset" },
  { commandId: "view.zoom_in", binding: "Mod+=", source: "preset" },
  { commandId: "view.zoom_out", binding: "Mod+-", source: "preset" },
  { commandId: "view.zoom_reset", binding: "Mod+0", source: "preset" },

  // Markdown-specific
  { commandId: "md.bold", binding: "Mod+B", source: "preset" },
  { commandId: "md.italic", binding: "Mod+I", source: "preset" },
  { commandId: "md.heading_cycle", binding: "Mod+Shift+H", source: "preset" },
  { commandId: "md.toggle_checkbox", binding: "Mod+Enter", source: "preset" },
  { commandId: "md.preview_focus", binding: "Mod+K V", source: "preset" },

  // AI
  { commandId: "ai.improve_selection", binding: "Mod+K I", source: "preset" },
  { commandId: "ai.continue_writing", binding: "Mod+K C", source: "preset" },
  { commandId: "ai.summarise", binding: "Mod+K U", source: "preset" },

  // Help / keybinding sheet
  { commandId: "help.shortcuts", binding: "Mod+/", source: "preset" },
  { commandId: "help.about", binding: "Mod+K A", source: "preset" },
];

// Note: Mod+B appears twice (view.toggle_sidebar, md.bold) and Mod+/
// appears twice (edit.toggle_comment, help.shortcuts). The conflict
// resolver in S-KB-005 handles these contextually — sidebar / shortcut
// sheet apply outside the editor, bold/comment inside it. The
// resolver consults the `when` clause that lives on the command
// descriptor (added by the CP unit).
