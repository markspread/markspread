// S-MD-036/037: GFM footnote helpers.
//
// S-MD-036 — recognise references (`[^1]`) and definitions
// (`[^1]: …`). lang-markdown's GFM bundle handles the actual parse;
// we add a `Mod-Alt-f` shortcut that inserts the next available
// reference at the cursor and appends a stub definition at the
// document tail.
//
// S-MD-037 — auto-numbering: when the user types `[^]` (empty
// label) we replace it with `[^N]` where N is the next free integer
// label not already present in the doc.

import { keymap, type Command, EditorView } from "@codemirror/view";
import { Prec, EditorSelection, type Extension } from "@codemirror/state";

const REF_RE = /\[\^([\w-]+)\]/g;
const EMPTY_REF_RE = /\[\^\](?!:)/; // `[^]` not followed by ':' (avoid eating defs)

function nextLabel(text: string): string {
  const used = new Set<string>();
  let m: RegExpExecArray | null;
  REF_RE.lastIndex = 0;
  while ((m = REF_RE.exec(text))) used.add(m[1] ?? "");
  let n = 1;
  while (used.has(String(n))) n++;
  return String(n);
}

const insertFootnote: Command = (view) => {
  const { state } = view;
  const sel = state.selection.main;
  const label = nextLabel(state.doc.toString());
  const ref = `[^${label}]`;
  const def = `\n\n[^${label}]: `;
  const lastPos = state.doc.length;
  // Insert the reference at the cursor, then append the stub
  // definition at end of doc, parking the caret on the definition's
  // empty value. Single transaction → single undo.
  const refInsert = { from: sel.head, insert: ref };
  const defInsert = { from: lastPos, insert: def };
  const finalCaret = lastPos + def.length + (sel.head <= lastPos ? ref.length : 0);
  view.dispatch({
    changes: [refInsert, defInsert],
    selection: EditorSelection.cursor(finalCaret),
    userEvent: "input.footnote.insert",
    scrollIntoView: true,
  });
  return true;
};

// S-MD-037: catch `[^]` and rewrite to `[^N]`.
const emptyFootnoteAutonumber = EditorView.updateListener.of((u) => {
  if (!u.docChanged) return;
  for (const tr of u.transactions) {
    if (!tr.docChanged) continue;
    let hit: { from: number; to: number; label: string } | null = null;
    tr.changes.iterChanges((_fA, _tA, _fB, tB, inserted) => {
      if (hit) return;
      if (!inserted.toString().endsWith("]")) return;
      const line = u.state.doc.lineAt(tB);
      const slice = line.text;
      const localPos = tB - line.from;
      const around = slice.slice(Math.max(0, localPos - 3), localPos);
      if (around === "[^]") {
        const label = nextLabel(u.state.doc.toString());
        hit = {
          from: line.from + localPos - 3,
          to: line.from + localPos,
          label,
        };
      }
    });
    if (hit) {
      const h = hit as { from: number; to: number; label: string };
      queueMicrotask(() => {
        u.view.dispatch({
          changes: { from: h.from, to: h.to, insert: `[^${h.label}]` },
          userEvent: "input.footnote.autonumber",
        });
      });
      break;
    }
  }
});

export function footnotesExtension(): Extension {
  return [
    Prec.high(keymap.of([{ key: "Mod-Alt-f", run: insertFootnote }])),
    emptyFootnoteAutonumber,
  ];
}

// Exported for tests.
export const __test__ = { nextLabel, REF_RE, EMPTY_REF_RE };
