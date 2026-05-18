// S-MD-002..S-MD-006: markdown formatting commands.
//
//   S-MD-002  ⌘1..⌘6   toggle heading at line start.
//   S-MD-003  ⌘B        toggle bold     (** **).
//   S-MD-004  ⌘I        toggle italic   (* *).
//   S-MD-005  ⌘E        toggle inline code  (` `).
//   S-MD-006  ⌘⇧X      toggle strikethrough  (~~ ~~).
//
// Toggle semantics for inline marks:
//   • If the selection is non-empty and is already wrapped in the
//     mark on both sides → unwrap.
//   • If non-empty and unwrapped → wrap, leaving the selection on the
//     inner text so a second toggle unwraps cleanly.
//   • If empty → insert the open+close pair and place the cursor in
//     the middle (acceptance: "선택 없을 때 `**|**` 삽입 + 커서 가운데").
//
// Heading toggle (per acceptance: "같은 레벨 두 번 → 헤딩 제거"):
//   • For each selected line, strip any existing leading `#+ ` first,
//     then prepend `<n># ` unless the existing level matched — in
//     which case we leave the line stripped (toggled off).

import { keymap, type Command } from "@codemirror/view";
import { EditorSelection, type Extension } from "@codemirror/state";

function toggleInline(open: string, close: string = open): Command {
  return (view) => {
    const { state } = view;
    const tr = state.changeByRange((range) => {
      if (range.empty) {
        const insert = open + close;
        return {
          changes: { from: range.from, insert },
          range: EditorSelection.cursor(range.from + open.length),
        };
      }
      const text = state.sliceDoc(range.from, range.to);
      const before = state.sliceDoc(
        Math.max(0, range.from - open.length),
        range.from,
      );
      const after = state.sliceDoc(
        range.to,
        Math.min(state.doc.length, range.to + close.length),
      );
      // Already wrapped → unwrap.
      if (before === open && after === close) {
        return {
          changes: [
            { from: range.from - open.length, to: range.from, insert: "" },
            { from: range.to, to: range.to + close.length, insert: "" },
          ],
          range: EditorSelection.range(
            range.from - open.length,
            range.to - open.length,
          ),
        };
      }
      // Selection itself starts/ends with the markers (e.g. user
      // selected the wrapped form).
      if (text.startsWith(open) && text.endsWith(close) && text.length >= open.length + close.length) {
        const stripped = text.slice(open.length, text.length - close.length);
        return {
          changes: { from: range.from, to: range.to, insert: stripped },
          range: EditorSelection.range(range.from, range.from + stripped.length),
        };
      }
      // Wrap.
      return {
        changes: { from: range.from, to: range.to, insert: open + text + close },
        range: EditorSelection.range(
          range.from + open.length,
          range.to + open.length,
        ),
      };
    });
    view.dispatch(state.update(tr, { userEvent: "input.format", scrollIntoView: true }));
    return true;
  };
}

function toggleHeading(level: number): Command {
  return (view) => {
    const { state } = view;
    const targetPrefix = "#".repeat(level) + " ";
    // Operate per-line over every line touched by any selection range.
    const lineSet = new Set<number>();
    for (const r of state.selection.ranges) {
      const a = state.doc.lineAt(r.from).number;
      const b = state.doc.lineAt(r.to).number;
      for (let i = a; i <= b; i++) lineSet.add(i);
    }
    const changes: { from: number; to: number; insert: string }[] = [];
    for (const lineNo of lineSet) {
      const line = state.doc.line(lineNo);
      const m = /^(#{1,6})\s+/.exec(line.text);
      if (m) {
        const existing = (m[1] ?? "").length;
        if (existing === level) {
          // Toggle off → strip.
          changes.push({ from: line.from, to: line.from + m[0].length, insert: "" });
        } else {
          // Replace level.
          changes.push({ from: line.from, to: line.from + m[0].length, insert: targetPrefix });
        }
      } else {
        changes.push({ from: line.from, to: line.from, insert: targetPrefix });
      }
    }
    if (changes.length === 0) return false;
    view.dispatch({
      changes,
      userEvent: "input.format.heading",
      scrollIntoView: true,
    });
    return true;
  };
}

const toggleBold = toggleInline("**");
const toggleItalic = toggleInline("*");
const toggleInlineCode = toggleInline("`");
const toggleStrikethrough = toggleInline("~~");

export function markdownFormatExtension(): Extension {
  return keymap.of([
    // S-MD-002
    { key: "Mod-1", run: toggleHeading(1), preventDefault: true },
    { key: "Mod-2", run: toggleHeading(2), preventDefault: true },
    { key: "Mod-3", run: toggleHeading(3), preventDefault: true },
    { key: "Mod-4", run: toggleHeading(4), preventDefault: true },
    { key: "Mod-5", run: toggleHeading(5), preventDefault: true },
    { key: "Mod-6", run: toggleHeading(6), preventDefault: true },
    // S-MD-003..006
    { key: "Mod-b", run: toggleBold, preventDefault: true },
    { key: "Mod-i", run: toggleItalic, preventDefault: true },
    { key: "Mod-e", run: toggleInlineCode, preventDefault: true },
    { key: "Mod-Shift-x", run: toggleStrikethrough, preventDefault: true },
  ]);
}
