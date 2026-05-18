// S-ED-056: clicking the line-number gutter selects the whole line.
// Drag extends; Shift+Click extends from the existing anchor.
//
// CM6's `lineNumbers()` extension takes a `domEventHandlers` option so
// we can hang a mousedown listener on the gutter without owning the
// gutter implementation. The handler:
//
//   • Plain click  → select that line.
//   • Shift-click  → extend the existing main range to that line.
//   • Drag         → on mousedown we install a mousemove listener that
//                    extends the selection as the cursor moves over
//                    other gutter rows; mouseup tears it down.

import { lineNumbers, type EditorView } from "@codemirror/view";
import { EditorSelection } from "@codemirror/state";
import type { Extension } from "@codemirror/state";

function selectLineRange(
  view: EditorView,
  fromLine: number,
  toLine: number,
): void {
  const start = Math.min(fromLine, toLine);
  const end = Math.max(fromLine, toLine);
  const startPos = view.state.doc.line(start).from;
  const endPos =
    end >= view.state.doc.lines
      ? view.state.doc.length
      : view.state.doc.line(end + 1).from;
  const anchor = fromLine <= toLine ? startPos : endPos;
  const head = fromLine <= toLine ? endPos : startPos;
  view.dispatch({
    selection: EditorSelection.single(anchor, head),
    userEvent: "select.gutter",
  });
}

export function lineNumberClickExtension(): Extension {
  return lineNumbers({
    domEventHandlers: {
      mousedown(view, line, event) {
        const e = event as MouseEvent;
        const lineNo = view.state.doc.lineAt(line.from).number;
        if (e.shiftKey) {
          const anchor = view.state.selection.main.anchor;
          const anchorLine = view.state.doc.lineAt(anchor).number;
          selectLineRange(view, anchorLine, lineNo);
        } else {
          selectLineRange(view, lineNo, lineNo);
        }
        // Drag-to-extend: while the mouse is held, watch for the
        // pointer crossing into other gutter rows.
        const startLine = lineNo;
        const onMove = (ev: MouseEvent) => {
          const pos = view.posAtCoords({ x: ev.clientX, y: ev.clientY });
          if (pos == null) return;
          const targetLine = view.state.doc.lineAt(pos).number;
          selectLineRange(view, startLine, targetLine);
        };
        const onUp = () => {
          window.removeEventListener("mousemove", onMove);
          window.removeEventListener("mouseup", onUp);
        };
        window.addEventListener("mousemove", onMove);
        window.addEventListener("mouseup", onUp);
        return true;
      },
    },
  });
}
