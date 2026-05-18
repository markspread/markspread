// S-ED-046..S-ED-049: IME / RTL.
//
// CM6's `contentEditable` host owns composition. The browser hands us
// `compositionstart` / `compositionupdate` / `compositionend` events,
// CM6 buffers the composing text inline, and on `compositionend` the
// committed string lands in the document via a single transaction
// (userEvent: "input.type"). We don't need any extra wiring for the
// editor side — the work was on the keymap side (S-KB-008 IME guard,
// already shipped) so chord prefixes and chord matchers don't fire
// during IME composition and accidentally swallow committed text.
//
// What this module does:
//   • Adds a class on the host while composition is active so themes
//     can render an "isComposing" affordance (colour / underline) for
//     the partial syllable. Korean (한글) hits this for every keystroke;
//     Japanese (かな→漢字) and Chinese (拼音→汉字) hit it during
//     candidate selection. The styling itself is up to TH unit themes.
//   • A no-op for RTL (S-ED-049, v2 — deferred per spec).
//
// Acceptance recap:
//   S-ED-046 IME 한글: 조합 중 표시 → `.cm-composing` class on host.
//   S-ED-047 IME 일본어: 변환 후보 → browser-native popup, no work.
//   S-ED-048 IME 중국어: 병음 후보 → browser-native popup, no work.
//   S-ED-049 RTL: v2 — `EditorView.contentAttributes.of({ dir: "rtl" })`
//     extension shape is documented for the future migration.

import type { Extension } from "@codemirror/state";
import { EditorView } from "@codemirror/view";

export function imeExtension(): Extension {
  return EditorView.domEventHandlers({
    compositionstart(_event, view) {
      view.dom.classList.add("cm-composing");
    },
    compositionend(_event, view) {
      view.dom.classList.remove("cm-composing");
    },
  });
}
