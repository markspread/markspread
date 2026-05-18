// S-ED-045: ⌘G — Go To Line.
//
// Acceptance: "입력 라인:열, Esc 취소". @codemirror/search ships
// `gotoLine` as a panel command that opens a small input prompting
// for `<line>` or `<line>:<col>`, accepts +N / -N relative jumps, and
// closes on Escape — exactly the spec.
//
// Keymap conflict: `searchKeymap` binds Mod-g to `findNext`, which is
// also user muscle memory ("⌘G = find next" in nearly every macOS
// app). The spec asks for ⌘G → Go To Line, so we honour the spec by
// overriding with `Prec.highest`. Find-next is still reachable via:
//   • F3        (cross-platform)
//   • Mod-Shift-g  (find previous, default — symmetric)
//   • Mod-g while the search panel is open — search panel installs a
//     local keymap that intercepts Mod-g back into findNext.
//
// We document this trade-off rather than silently re-mapping; users
// who want the OS convention can rebind via the keybindings file.

import { gotoLine } from "@codemirror/search";
import { keymap } from "@codemirror/view";
import { Prec, type Extension } from "@codemirror/state";

export function gotoLineExtension(): Extension {
  return Prec.highest(
    keymap.of([
      { key: "Mod-g", run: gotoLine, preventDefault: true },
      // VS Code's "Go to Line" Mac default — alias for users coming
      // from there.
      { key: "Ctrl-g", run: gotoLine, preventDefault: true },
    ]),
  );
}
