// S-ED-012/013/014: folding for markdown documents.
//
// Markdown's grammar (lezer-markdown) doesn't tag headings with a
// foldable range out of the box: a heading node spans only its own
// line. We compute the foldable range manually — from the end of the
// heading line to the start of the next heading at the same or
// shallower depth. Code blocks (FencedCode) get the standard "fold
// from end-of-fence-open to start-of-fence-close" treatment via the
// markdown grammar's existing structure.

import {
  foldEffect,
  foldGutter,
  foldKeymap,
  foldService,
  foldedRanges,
  unfoldEffect,
} from "@codemirror/language";
import { syntaxTree } from "@codemirror/language";
import { type EditorState, type Extension, type StateEffect, StateField } from "@codemirror/state";
import { keymap } from "@codemirror/view";

const HEADING_RE = /^(#{1,6})\s/;

function headingDepth(state: EditorState, lineNum: number): number | null {
  const line = state.doc.line(lineNum);
  const m = HEADING_RE.exec(line.text);
  return m ? (m[1] ?? "").length : null;
}

function headingFoldRange(
  state: EditorState,
  lineStart: number,
  _lineEnd: number,
): { from: number; to: number } | null {
  // S-ED-012: a heading folds from the end of its own line to the
  // line before the next heading of equal or shallower depth (or to
  // the end of the document if there is none).
  const startLine = state.doc.lineAt(lineStart);
  const depth = headingDepth(state, startLine.number);
  if (depth == null) return null;

  let lastLine = startLine.number;
  for (let i = startLine.number + 1; i <= state.doc.lines; i++) {
    const d = headingDepth(state, i);
    if (d != null && d <= depth) break;
    lastLine = i;
  }
  if (lastLine === startLine.number) return null;
  return { from: startLine.to, to: state.doc.line(lastLine).to };
}

function codeBlockFoldRange(
  state: EditorState,
  from: number,
  to: number,
): { from: number; to: number } | null {
  // S-ED-013: rely on lezer-markdown's `FencedCode` node — its range
  // already spans the open fence line through the close fence line.
  // We fold from the end of the first line to the end of the
  // fenced-code node minus one line so the closing fence stays
  // visible.
  const tree = syntaxTree(state);
  let result: { from: number; to: number } | null = null;
  tree.iterate({
    from,
    to,
    enter(node) {
      if (node.name === "FencedCode") {
        const startLine = state.doc.lineAt(node.from);
        const endLine = state.doc.lineAt(node.to);
        if (endLine.number > startLine.number) {
          result = {
            from: startLine.to,
            to: state.doc.line(endLine.number - 1).to,
          };
        }
        return false;
      }
      return undefined;
    },
  });
  return result;
}

const markdownFoldService = foldService.of(
  (state, lineStart, lineEnd) =>
    headingFoldRange(state, lineStart, lineEnd) ?? codeBlockFoldRange(state, lineStart, lineEnd),
);

// S-ED-014: "fold all headings" command. Walks every line, asks the
// fold service for a range, and dispatches a single transaction that
// folds them all — single undo step keeps the user out of the
// "twenty unfold operations" trap.
export function foldAllHeadingsCommand(view: import("@codemirror/view").EditorView): boolean {
  const { state } = view;
  const effects: StateEffect<unknown>[] = [];
  for (let i = 1; i <= state.doc.lines; i++) {
    const line = state.doc.line(i);
    const range = headingFoldRange(state, line.from, line.to);
    if (range) effects.push(foldEffect.of(range));
  }
  if (effects.length === 0) return false;
  view.dispatch({ effects });
  return true;
}

export function unfoldAllCommand(view: import("@codemirror/view").EditorView): boolean {
  const ranges = foldedRanges(view.state);
  if (ranges.size === 0) return false;
  const effects: StateEffect<unknown>[] = [];
  ranges.between(0, view.state.doc.length, (from, to) => {
    effects.push(unfoldEffect.of({ from, to }));
  });
  view.dispatch({ effects });
  return true;
}

// Unused: silence "imported but unused" if upstream reshuffles. The
// StateField import keeps a hook for future per-tab persisted fold
// state (S-ED-014 follow-up).
void StateField;

export function foldingExtension(): Extension {
  return [
    markdownFoldService,
    foldGutter(),
    keymap.of([
      ...foldKeymap,
      // S-ED-014: ⌘K ⌘0 (chord) → fold all headings.
      // The chord engine (S-KB-009) routes the second step here.
      { key: "Mod-k Mod-0", run: foldAllHeadingsCommand },
      { key: "Mod-k Mod-j", run: unfoldAllCommand },
    ]),
  ];
}
