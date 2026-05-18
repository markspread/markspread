// S-MD-028: ⌘⇧Enter toggles the task checkbox on the cursor line(s).
//
// We support multi-cursor: every primary or secondary cursor that
// sits on a `- [ ] ` / `- [x] ` line flips that line. Lines that
// don't match are left untouched and don't break the command. If
// none of the cursors land on a task line we return false so other
// keymap layers (insertNewlineAndIndent etc.) can handle the chord.
//
// Also exports `applyTaskToggle()` which the preview path
// (S-MD-027) uses to rewrite a single source line via the editor's
// dispatch — keeps undo history coherent across both entry points.

import type { Command } from "@codemirror/view";
import { keymap } from "@codemirror/view";
import { Prec, type Extension, type EditorState } from "@codemirror/state";

const TASK_RE = /^(\s*[-*+]\s+\[)([ xX])(\])/;

export interface TaskToggleApply {
  lineIndex: number;
  oldLength: number;
  nextLine: string;
}

export const toggleTaskAtCursor: Command = (view) => {
  const { state } = view;
  const changes: { from: number; to: number; insert: string }[] = [];
  for (const range of state.selection.ranges) {
    const line = state.doc.lineAt(range.head);
    const m = TASK_RE.exec(line.text);
    if (!m) continue;
    const checked = m[2] !== " ";
    const next = line.text.replace(TASK_RE, `$1${checked ? " " : "x"}$3`);
    if (next === line.text) continue;
    changes.push({ from: line.from, to: line.to, insert: next });
  }
  if (changes.length === 0) return false;
  view.dispatch({ changes, userEvent: "input.task.toggle" });
  return true;
};

export function applyTaskToggle(state: EditorState, apply: TaskToggleApply) {
  // Map the 0-based source-line index from the preview into a
  // ChangeSpec the host can dispatch. We re-derive the line bounds
  // from the current state to stay correct even if the doc has
  // drifted between render and click.
  const targetLineNo = apply.lineIndex + 1;
  if (targetLineNo < 1 || targetLineNo > state.doc.lines) return null;
  const line = state.doc.line(targetLineNo);
  if (line.text.length !== apply.oldLength) return null; // raced
  return {
    changes: { from: line.from, to: line.to, insert: apply.nextLine },
    userEvent: "input.task.toggle.preview",
  };
}

export function taskToggleExtension(): Extension {
  return Prec.high(
    keymap.of([
      { key: "Mod-Shift-Enter", run: toggleTaskAtCursor },
    ]),
  );
}
