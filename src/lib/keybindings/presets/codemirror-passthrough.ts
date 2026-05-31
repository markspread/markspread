// M16: explicit whitelist of preset command IDs that intentionally do
// NOT have a host-side command registration. They are surfaced in the
// keybinding sheet for discoverability, but their effect comes from
// CodeMirror's own keymap (defaultKeymap, historyKeymap, searchKeymap,
// the markdown extension), which fires while the editor is focused.
//
// The preset-coverage test in `__tests__/index.test.ts` allows entries
// in this set to be missing from `src/lib/commands/registry.ts`.
//
// Adding to this set is a *deliberate* opt-out from host-command
// coverage — the new entry must already be handled by a CodeMirror
// extension or the editor's wiring, with a test that proves it.

export const codemirrorPassthroughCommandIds = new Set<string>([
  // History (historyKeymap)
  "edit.undo",
  "edit.redo",
  // Save — wired via the editor host's save hook, not the
  // command registry (S-ED-002 keeps the autosave + manual save
  // path inside the editor module).
  "edit.save",
  // Search / replace / goto (searchKeymap)
  "edit.find",
  "edit.find_replace",
  "edit.go_to_line",
  // Line manipulation (defaultKeymap)
  "edit.duplicate_line",
  "edit.delete_line",
  "edit.move_line_up",
  "edit.move_line_down",
  "edit.copy_line_up",
  "edit.copy_line_down",
  // Comment toggle (commentKeymap, included in defaultKeymap)
  "edit.toggle_comment",
]);
