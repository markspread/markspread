// S-ED-043 / S-ED-044: comment toggling.
//
// Markdown doesn't define a line-comment token — only the HTML block
// form `<!-- ... -->`. lang-markdown surfaces that via the
// `commentTokens` facet (`blockComment: { open: "<!--", close: "-->" }`),
// which CM6's stock `toggleComment` consumes.
//
// Spec mapping:
//   ⌘/    (S-ED-043) → toggleComment   — tries line first, falls back
//                                        to block. In markdown that's
//                                        always the HTML block form,
//                                        which is exactly what the
//                                        acceptance asks for.
//   ⌘⌥/   (S-ED-044) → toggleBlockComment — wraps the selection in
//                                        `<!-- ... -->`, or unwraps
//                                        if it already is.
//
// "코드 블록 안에선 언어별 주석" (S-ED-043 acceptance, "가능 시"):
// when the markdown grammar is configured with `codeLanguages` for
// the nested fence, lezer-markdown nests the inner language's syntax
// tree, and CM6 reads commentTokens from that nested language at the
// cursor position automatically. We don't add anything here — the
// behaviour falls out of CM6 + lang-markdown for free as soon as the
// nested language extension is wired (tracked in MD unit follow-up).

import { toggleBlockComment, toggleComment } from "@codemirror/commands";
import type { Extension } from "@codemirror/state";
import { keymap } from "@codemirror/view";

export function commentExtension(): Extension {
  return keymap.of([
    // S-ED-043
    { key: "Mod-/", run: toggleComment, preventDefault: true },
    // S-ED-044
    { key: "Mod-Alt-/", run: toggleBlockComment, preventDefault: true },
    // VS Code's "block comment" alternate keybinding kept as an alias.
    { key: "Shift-Alt-a", run: toggleBlockComment, preventDefault: true },
  ]);
}
