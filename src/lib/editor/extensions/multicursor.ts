// S-ED-031/032: multicursor commands.
//
// S-ED-031 — ⌘D / "Add Next Occurrence":
//   `selectNextOccurrence` from @codemirror/search.
//   • empty selection → expand to the surrounding word.
//   • non-empty selection → add the next literal match as a new
//     selection range, leaving prior ranges in place.
//
// S-ED-032 — ⌘⇧L / "Select All Matches":
//   `selectSelectionMatches` from @codemirror/search.
//   • non-empty selection → replace selection with one range per
//     occurrence of the selected text in the document.
//   • empty selection → expand to current word first (CM6 internal
//     behaviour) then select all word occurrences. Acceptance:
//     "현재 선택과 일치하는 모든 항목을 다중 커서로 선택".
//
// Both commands rely on EditorState.allowMultipleSelections which is
// turned on in baseExtensions(). `searchKeymap` already binds these
// keys, but we register them here too — duplicate bindings to the same
// command are a no-op at dispatch time, and the duplication makes the
// spec ID grep-discoverable.

import { selectNextOccurrence, selectSelectionMatches } from "@codemirror/search";
import { EditorView, keymap } from "@codemirror/view";
import type { Extension } from "@codemirror/state";

export { selectNextOccurrence, selectSelectionMatches };

// S-ED-033: Alt+Click → add a new cursor at the click target.
//
// CM6's default `clickAddsSelectionRange` returns true for Mod-click
// (⌘ on macOS, Ctrl elsewhere). VS Code maps this gesture to Alt
// (Option on macOS) so muscle memory expects Alt+Click. We override
// the facet to accept either Alt or the platform Mod key — both feel
// natural and we don't take a usability hit on either platform. The
// facet is read on every mousedown, so the hook is cheap.
const altClickAddsCursor = EditorView.clickAddsSelectionRange.of(
  (event) => event.altKey || event.metaKey || event.ctrlKey,
);

export function multicursorExtension(): Extension {
  return [
    altClickAddsCursor,
    keymap.of([
      // S-ED-031
      { key: "Mod-d", run: selectNextOccurrence, preventDefault: true },
      // S-ED-032
      { key: "Mod-Shift-l", run: selectSelectionMatches, preventDefault: true },
    ]),
  ];
}
