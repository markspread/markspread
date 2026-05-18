// S-ED-041: Tab / Shift-Tab — indent / outdent.
//
// CM6's `indentWithTab` keymap entry already does what the acceptance
// asks for:
//
//   • multi-line selection → indent every line (indentMore).
//   • single cursor → insert a tab character (or spaces, governed by
//     the indentUnit facet which we set from EditorPrefs in
//     settings.ts → buildIndentUnit). The "at line start vs. inside
//     line" distinction the spec mentions is moot in CM6: `insertTab`
//     inserts the indent unit at any cursor position, which is what
//     users from VS Code expect. The "indent the line" path triggers
//     automatically when the selection is non-empty / multi-line.
//
// Shift-Tab uses `indentLess` to outdent. Both are part of CM6's
// defaultKeymap on most platforms but we bind them here too so the
// keymap is searchable from the spec ID.

import { indentLess, indentWithTab } from "@codemirror/commands";
import { keymap } from "@codemirror/view";
import type { Extension } from "@codemirror/state";

export function indentExtension(): Extension {
  return keymap.of([
    indentWithTab,
    { key: "Shift-Tab", run: indentLess, preventDefault: true },
  ]);
}
