// S-ED-058 / S-ED-059: large-file handling.
//
// S-ED-058 (>5MB): CM6's viewport policy already renders only the
// visible window + a 1000-line buffer. Nothing to wire — opening a
// 5–50MB markdown file Just Works at native scroll speed because
// `RangeSet`-driven decoration and the gutter are both viewport-
// scoped. This module's only job for that scenario is to *not* layer
// any per-line decorations that would force full-document iteration
// (e.g. a `decorations: state.doc.lines` walk). Other modules in
// this folder follow that rule by construction.
//
// S-ED-059 (>50MB): we step the editor into a read-only mode and
// surface a warning. `EditorView.editable.of(false)` keeps history,
// scroll, search, gutter clicks all working — only mutation is
// blocked, which matches user expectation for "this is too big to
// edit safely".
//
// The size threshold can be overridden per-tab (some power users want
// to bump it once they understand the trade-off).

import { Compartment, type Extension } from "@codemirror/state";
import { EditorView } from "@codemirror/view";

export const READ_ONLY_THRESHOLD_BYTES = 50 * 1024 * 1024; // 50MB
export const VIEWPORT_HINT_BYTES = 5 * 1024 * 1024; // 5MB

const readOnlyCompartment = new Compartment();

export function largeFileExtension(initialSize: number): Extension {
  return readOnlyCompartment.of(
    initialSize > READ_ONLY_THRESHOLD_BYTES ? EditorView.editable.of(false) : [],
  );
}

export function setReadOnly(view: EditorView, readOnly: boolean): void {
  view.dispatch({
    effects: readOnlyCompartment.reconfigure(readOnly ? EditorView.editable.of(false) : []),
  });
}

export function shouldOpenReadOnly(byteSize: number): boolean {
  return byteSize > READ_ONLY_THRESHOLD_BYTES;
}
