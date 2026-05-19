// Test-only helper: extract a keymap-bound Command from an extension.
//
// `state.facet(keymap)` yields an array of KeyBinding arrays (one per
// `keymap.of(...)` call), so we flatten and match on the `key` field.

import { EditorState, type Extension } from "@codemirror/state";
import { type Command, keymap } from "@codemirror/view";

export function findKeymapCommand(ext: Extension, key: string): Command {
  const state = EditorState.create({ extensions: ext });
  for (const group of state.facet(keymap)) {
    const bindings = Array.isArray(group) ? group : [group];
    for (const km of bindings) {
      if (km && km.key === key && km.run) return km.run;
    }
  }
  throw new Error(`no command for ${key}`);
}
