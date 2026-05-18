// S-ED-042: smart Enter for markdown.
//
// Acceptance: 리스트(`- ` `1. `) 자동 이어쓰기 + 빈 항목 시 자동 종료.
// We intercept Enter and check the line the cursor sits on:
//
//   • bullet list (`-` `*` `+` followed by a space) → carry the same
//     marker (and its indent) onto the next line.
//   • ordered list (`<num>.` or `<num>)` followed by a space) → carry
//     the indent and increment the number.
//   • blockquote (`>` markers) → carry the markers.
//   • task list (`- [ ]`/`- [x]`) → carry the bullet, reset the
//     checkbox to `[ ]`. Marking a task complete shouldn't propagate.
//   • a list line whose content is empty (just the marker, optional
//     trailing space) → strip the marker, terminating the list.
//
// On no match we return false so CM6's `insertNewlineAndIndent`
// (already wired in defaultKeymap) handles the generic "preserve
// indent of previous line" path.

import { insertNewlineAndIndent } from "@codemirror/commands";
import { type Extension, Prec } from "@codemirror/state";
import { type Command, keymap } from "@codemirror/view";

const BULLET_RE = /^(\s*)([-*+])(\s+\[[ xX]\])?(\s+)(.*)$/;
const ORDERED_RE = /^(\s*)(\d+)([.)])(\s+)(.*)$/;
const QUOTE_RE = /^(\s*(?:>\s*)+)(.*)$/;

const markdownEnter: Command = (view) => {
  const { state } = view;
  const sel = state.selection.main;
  if (!sel.empty) return false;
  const line = state.doc.lineAt(sel.head);
  const text = line.text;
  const cursorCol = sel.head - line.from;

  // Bullet / task list
  const bullet = BULLET_RE.exec(text);
  if (bullet) {
    const [, indent = "", marker = "", task, gap = "", content = ""] = bullet;
    const prefixLen = indent.length + marker.length + (task ?? "").length + gap.length;
    if (cursorCol < prefixLen) return false;
    if (content.trim() === "") {
      // Empty item — terminate the list. Replace the entire line with
      // its leading indent (so a still-indented blank line follows).
      view.dispatch({
        changes: { from: line.from, to: line.to, insert: indent },
        selection: { anchor: line.from + indent.length },
        userEvent: "input",
      });
      return true;
    }
    const taskBox = task ? " [ ]" : "";
    const insert = `\n${indent}${marker}${taskBox}${gap}`;
    view.dispatch({
      changes: { from: sel.head, insert },
      selection: { anchor: sel.head + insert.length },
      userEvent: "input",
      scrollIntoView: true,
    });
    return true;
  }

  // Ordered list
  const ordered = ORDERED_RE.exec(text);
  if (ordered) {
    const [, indent = "", numStr = "", sep = "", gap = "", content = ""] = ordered;
    const num = Number(numStr);
    const prefixLen = indent.length + numStr.length + sep.length + gap.length;
    if (cursorCol < prefixLen) return false;
    if (content.trim() === "") {
      view.dispatch({
        changes: { from: line.from, to: line.to, insert: indent },
        selection: { anchor: line.from + indent.length },
        userEvent: "input",
      });
      return true;
    }
    // S-MD-025: walk forward and renumber every contiguous ordered
    // item at the same indent + separator (`.` vs `)`). We rewrite
    // unconditionally so a previously-broken sequence (e.g. duplicate
    // 2.) heals, while stopping at the first non-list / different-
    // indent line so adjacent lists stay independent.
    const insert = `\n${indent}${num + 1}${sep}${gap}`;
    const changes: { from: number; to: number; insert: string }[] = [
      { from: sel.head, to: sel.head, insert },
    ];
    let nextNum = num + 2;
    let lineNo = line.number + 1;
    while (lineNo <= state.doc.lines) {
      const ln = state.doc.line(lineNo);
      const m = ORDERED_RE.exec(ln.text);
      if (!m) break;
      const [, ind2 = "", n2 = "", sep2 = ""] = m;
      if (ind2 !== indent || sep2 !== sep) break;
      if (Number(n2) !== nextNum) {
        changes.push({
          from: ln.from + ind2.length,
          to: ln.from + ind2.length + n2.length,
          insert: String(nextNum),
        });
      }
      nextNum++;
      lineNo++;
    }
    view.dispatch({
      changes,
      selection: { anchor: sel.head + insert.length },
      userEvent: "input",
      scrollIntoView: true,
    });
    return true;
  }

  // Blockquote
  const quote = QUOTE_RE.exec(text);
  if (quote) {
    const [, prefix = "", content = ""] = quote;
    const prefixLen = prefix.length;
    if (cursorCol < prefixLen) return false;
    if (content.trim() === "") {
      view.dispatch({
        changes: { from: line.from, to: line.to, insert: "" },
        userEvent: "input",
      });
      return true;
    }
    const insert = `\n${prefix}`;
    view.dispatch({
      changes: { from: sel.head, insert },
      selection: { anchor: sel.head + insert.length },
      userEvent: "input",
      scrollIntoView: true,
    });
    return true;
  }

  return false;
};

export function markdownEnterExtension(): Extension {
  // Prec.high so we win against defaultKeymap's stock Enter binding;
  // when our list/quote logic doesn't apply we fall through to
  // insertNewlineAndIndent ourselves (returning true keeps CM6 from
  // also dispatching the default).
  return Prec.high(
    keymap.of([
      {
        key: "Enter",
        run: (view) => markdownEnter(view) || insertNewlineAndIndent(view),
      },
    ]),
  );
}
