// S-MD-034: Command-palette "Insert Table" entry.
//
// Public API:
//   • setInsertTableOpener — host (React) registers a function that
//     opens the dialog and resolves with rows/cols/alignment.
//   • insertTable — the CodeMirror Command. The palette wires this up;
//     it can also be bound to a keychord later.
//
// We intentionally keep the dialog UX away from this module so the
// editor command stays unit-test friendly.

import type { Command } from "@codemirror/view";

export type ColumnAlign = "left" | "center" | "right" | "default";

export interface InsertTableRequest {
  resolve: (result: InsertTableResult | null) => void;
}

export interface InsertTableResult {
  rows: number; // body rows, excluding header
  cols: number;
  align: ColumnAlign[];
}

let opener: (req: InsertTableRequest) => void = () => {};

export function setInsertTableOpener(fn: (req: InsertTableRequest) => void) {
  opener = fn;
}

function alignToken(align: ColumnAlign): string {
  switch (align) {
    case "left":
      return ":---";
    case "right":
      return "---:";
    case "center":
      return ":---:";
    default:
      return "---";
  }
}

export function buildTableMarkdown(result: InsertTableResult): string {
  const { rows, cols, align } = result;
  const header = `|${" "
    .repeat(cols)
    .split("")
    .map(() => "  ")
    .join("|")}|`;
  const sep = `|${align
    .slice(0, cols)
    .concat(Array(Math.max(0, cols - align.length)).fill("default" as ColumnAlign))
    .map((a) => ` ${alignToken(a)} `)
    .join("|")}|`;
  const body = Array(rows)
    .fill(0)
    .map(() => `|${"  |".repeat(cols)}`)
    .join("\n");
  return [header, sep, body].filter(Boolean).join("\n");
}

export const insertTable: Command = (view) => {
  new Promise<InsertTableResult | null>((resolve) => {
    opener({ resolve });
  }).then((result) => {
    if (!result) return;
    const md = buildTableMarkdown(result);
    const sel = view.state.selection.main;
    const line = view.state.doc.lineAt(sel.head);
    // Insert on its own line: prefix newline if we're not already at
    // the start of a blank line.
    const atLineStart = sel.head === line.from;
    const prefix = atLineStart && line.text === "" ? "" : "\n";
    const insert = `${prefix}${md}\n`;
    view.dispatch({
      changes: { from: sel.head, insert },
      selection: { anchor: sel.head + insert.length },
      userEvent: "input.table.insert",
      scrollIntoView: true,
    });
  });
  return true;
};
