// S-ED-060: reconcile editor state with an external change to the
// underlying file (someone edited it in another app, a git pull
// rewrote it, etc.).
//
// Strategy: the file IO layer (FS unit) owns a watcher; when it
// detects a change, it calls `reconcileExternalChange(view, newDoc)`.
// The reconciler:
//
//   • If the doc on disk is byte-identical to the editor's doc → no-op.
//   • If the editor's doc is "clean" (no unsaved changes since last
//     save), we replace the doc and preserve the selection at the
//     same offset (clamped). This is the "git pull" path.
//   • If the editor has unsaved changes, we dispatch a `userEvent:
//     "external.replace"` transaction that swaps the entire doc in a
//     single change — this lets the user undo back to their unsaved
//     state. The UI layer is expected to surface a "file changed on
//     disk" toast in this branch (FS-* unit).
//
// History semantics: a single transaction swap means one undo step
// returns to the pre-reconcile state. Selection clamping uses the
// pre-reconcile head; if the new doc is shorter, we clamp to the new
// length.

import { EditorSelection } from "@codemirror/state";
import type { EditorView } from "@codemirror/view";

export interface ReconcileResult {
  applied: boolean;
  /** True iff the editor had unsaved local edits at reconcile time. */
  hadLocalChanges: boolean;
}

export function reconcileExternalChange(
  view: EditorView,
  nextDoc: string,
  hasLocalChanges: boolean,
): ReconcileResult {
  const current = view.state.doc.toString();
  if (current === nextDoc) return { applied: false, hadLocalChanges: false };

  const head = view.state.selection.main.head;
  const clampedHead = Math.min(head, nextDoc.length);

  view.dispatch({
    changes: { from: 0, to: view.state.doc.length, insert: nextDoc },
    selection: EditorSelection.cursor(clampedHead),
    userEvent: hasLocalChanges ? "external.replace.dirty" : "external.replace",
    scrollIntoView: false,
  });

  return { applied: true, hadLocalChanges: hasLocalChanges };
}
