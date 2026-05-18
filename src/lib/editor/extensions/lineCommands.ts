// S-ED-034..S-ED-038: line-level editing commands.
//
// All of these are stock @codemirror/commands functions — registering
// them in a single dedicated module makes the spec → key map a one-
// click trace and keeps the keymap entry free of "where is this
// command from?" guesswork.
//
//   S-ED-034  ⌥↑ / ⌥↓        moveLineUp / moveLineDown
//   S-ED-035  ⌘⇧D            copyLineDown            (also ⌥⇧↓ accepted
//                              as a convenience alias)
//   S-ED-036  ⌘⇧K            deleteLine
//   S-ED-037  ⌘L             selectLine
//   S-ED-038  ⌘Delete        deleteToLineEnd          (Mod-Backspace
//                              kept for cross-platform parity)
//
// CM6's commands operate on every selection range so multi-cursor
// flows (S-ED-031..033) automatically extend here — they all dispatch
// a single transaction so undo collapses to one step (S-ED-034
// acceptance: "다중 커서/선택 모두 함께 이동, undo는 단일 트랜잭션").

import {
  copyLineDown,
  copyLineUp,
  deleteLine,
  deleteToLineEnd,
  moveLineDown,
  moveLineUp,
  selectLine,
} from "@codemirror/commands";
import { keymap } from "@codemirror/view";
import type { Extension } from "@codemirror/state";

export function lineCommandsExtension(): Extension {
  return keymap.of([
    // S-ED-034
    { key: "Alt-ArrowUp", run: moveLineUp, preventDefault: true },
    { key: "Alt-ArrowDown", run: moveLineDown, preventDefault: true },
    // S-ED-035 — VS Code's ⌘⇧D for "duplicate line down" maps cleanly
    // to copyLineDown. ⌥⇧↓ / ⌥⇧↑ kept as accepted aliases (some users
    // come from JetBrains where this is the default).
    { key: "Mod-Shift-d", run: copyLineDown, preventDefault: true },
    { key: "Alt-Shift-ArrowDown", run: copyLineDown, preventDefault: true },
    { key: "Alt-Shift-ArrowUp", run: copyLineUp, preventDefault: true },
    // S-ED-036
    { key: "Mod-Shift-k", run: deleteLine, preventDefault: true },
    // S-ED-037
    { key: "Mod-l", run: selectLine, preventDefault: true },
    // S-ED-038. We deliberately don't rebind Mod-Backspace — that's
    // platform "delete to line start" everywhere and overriding it
    // would surprise users coming from any other editor.
    { key: "Mod-Delete", run: deleteToLineEnd, preventDefault: true },
  ]);
}
