// S-MD-029..033: GFM table input helpers.
//
// Detection: a "table line" is one whose `text.trim()` starts and
// ends with `|` (or contains a top-level `|` and the doc above/below
// matches the GFM separator pattern). For Tab navigation we use the
// looser "contains a `|` and we're inside a `|...|` segment" so the
// caret jumps cell-to-cell as you type the body. The alignment-row
// auto-format only triggers once a `|---|` style separator is typed
// directly under a header row.
//
// We avoid re-implementing a full table parser; lang-markdown's GFM
// extension still owns syntax highlighting + linting. Our work is
// limited to caret motion and cosmetic alignment of pipes in the
// header separator (S-MD-029).

import { keymap, type Command } from "@codemirror/view";
import { Prec, type Extension, EditorSelection } from "@codemirror/state";

const SEP_RE = /^\s*\|?\s*:?-{3,}:?\s*(\|\s*:?-{3,}:?\s*)+\|?\s*$/;

function isTableLine(text: string): boolean {
  const t = text.trim();
  return t.startsWith("|") && t.endsWith("|") && t.includes("|", 1);
}

/**
 * Returns the absolute pipe positions on a line (so we can jump the
 * caret between them). Pipes preceded by `\` are treated as escaped.
 */
function pipePositions(line: { from: number; text: string }): number[] {
  const pos: number[] = [];
  for (let i = 0; i < line.text.length; i++) {
    const ch = line.text[i];
    if (ch === "|" && line.text[i - 1] !== "\\") pos.push(line.from + i);
  }
  return pos;
}

const tableNextCell: Command = (view) => {
  const { state } = view;
  const sel = state.selection.main;
  const line = state.doc.lineAt(sel.head);
  if (!isTableLine(line.text)) return false;
  const pipes = pipePositions(line);
  // Find the next pipe strictly after the cursor.
  const nextPipe = pipes.find((p) => p > sel.head);
  if (nextPipe == null) {
    // S-MD-032: Tab on last cell → create a new empty row mirroring
    // the column count, place the caret in the first cell.
    const cellCount = pipes.length - 1;
    if (cellCount < 1) return false;
    const newRow = "\n|" + " |".repeat(cellCount);
    view.dispatch({
      changes: { from: line.to, insert: newRow },
      selection: EditorSelection.cursor(line.to + 2),
      userEvent: "input.table.newrow",
      scrollIntoView: true,
    });
    return true;
  }
  // Park the caret one column past the pipe (so we land *inside* the
  // next cell, not on the pipe itself).
  const target = Math.min(nextPipe + 2, line.to);
  view.dispatch({
    selection: EditorSelection.cursor(target),
    scrollIntoView: true,
  });
  return true;
};

const tablePrevCell: Command = (view) => {
  const { state } = view;
  const sel = state.selection.main;
  const line = state.doc.lineAt(sel.head);
  if (!isTableLine(line.text)) return false;
  const pipes = pipePositions(line);
  // Find the pipe immediately before the previous cell boundary.
  // We want to land "inside" the previous cell — i.e. one col after
  // the pipe that opens it.
  let prevPipe: number | undefined;
  for (let i = pipes.length - 1; i >= 0; i--) {
    if ((pipes[i] ?? 0) < sel.head - 1) {
      // Skip pipes adjacent to caret: we want a real column step.
      // The opening pipe of the *previous* cell sits one further
      // back than the one immediately before the cursor.
      prevPipe = pipes[i - 1] ?? pipes[i];
      break;
    }
  }
  if (prevPipe == null) return false;
  const target = Math.min(prevPipe + 2, line.to);
  view.dispatch({
    selection: EditorSelection.cursor(target),
    scrollIntoView: true,
  });
  return true;
};

const tableEnter: Command = (view) => {
  const { state } = view;
  const sel = state.selection.main;
  if (!sel.empty) return false;
  const line = state.doc.lineAt(sel.head);
  if (!isTableLine(line.text)) return false;
  const pipes = pipePositions(line);
  const lastPipe = pipes[pipes.length - 1];
  // Only fire when caret is at-or-past the last pipe (S-MD-032).
  if (lastPipe === undefined || sel.head < lastPipe) return false;
  const cellCount = pipes.length - 1;
  if (cellCount < 1) return false;
  const newRow = "\n|" + " |".repeat(cellCount);
  view.dispatch({
    changes: { from: line.to, insert: newRow },
    selection: EditorSelection.cursor(line.to + 2),
    userEvent: "input.table.newrow",
    scrollIntoView: true,
  });
  return true;
};

// S-MD-029 + S-MD-033: pretty-format the header separator row when
// the user just finishes typing it. We re-pad each `---` segment to
// the widest cell in the header row so the columns line up, while
// preserving alignment markers (`:---`, `---:`, `:---:`).
import { EditorView } from "@codemirror/view";
const tableSeparatorAutoformat = EditorView.updateListener.of((u) => {
  if (!u.docChanged) return;
  const sel = u.state.selection.main;
  if (!sel.empty) return;
  const line = u.state.doc.lineAt(sel.head);
  if (!SEP_RE.test(line.text)) return;
  const headerLine = line.number > 1 ? u.state.doc.line(line.number - 1) : null;
  if (!headerLine || !isTableLine(headerLine.text)) return;
  const headerCells = headerLine.text
    .replace(/^\s*\|/, "")
    .replace(/\|\s*$/, "")
    .split("|")
    .map((c) => c.trim());
  const sepCells = line.text
    .replace(/^\s*\|/, "")
    .replace(/\|\s*$/, "")
    .split("|")
    .map((c) => c.trim());
  if (sepCells.length !== headerCells.length) return;
  const padded = sepCells.map((cell, i) => {
    const colon = {
      left: cell.startsWith(":"),
      right: cell.endsWith(":"),
    };
    const minDashes = Math.max(3, (headerCells[i] ?? "").length - (Number(colon.left) + Number(colon.right)));
    const dashes = "-".repeat(minDashes);
    return ` ${colon.left ? ":" : ""}${dashes}${colon.right ? ":" : ""} `;
  });
  const next = "|" + padded.join("|") + "|";
  if (next === line.text) return;
  // Defer dispatch to a microtask so we don't recurse into our own
  // updateListener inside the same transaction.
  queueMicrotask(() => {
    u.view.dispatch({
      changes: { from: line.from, to: line.to, insert: next },
      userEvent: "input.table.format",
    });
  });
});

export function tablesExtension(): Extension {
  return [
    Prec.high(
      keymap.of([
        { key: "Tab", run: tableNextCell },
        { key: "Shift-Tab", run: tablePrevCell },
        { key: "Enter", run: tableEnter },
      ]),
    ),
    tableSeparatorAutoformat,
  ];
}
