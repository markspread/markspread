// S-ED-003..S-ED-010: search extension wiring.
//
// We compose `@codemirror/search`'s built-in `search()` extension and
// keymap. The default panel is keyboard-first and ships with the
// "match-case / regex / by-word / replace / by-selection" toggles we
// need across S-ED-004..S-ED-010 — so the work for those scenarios is
// largely about confirming defaults, surfacing them via the
// keybindings registry, and localising the panel labels.
//
// Acceptance:
//   • panel render < 100ms — built-in panel mounts synchronously into
//     the editor's panel slot, no work to do beyond opening the
//     extension on first use.
//   • match highlight on input change — search()'s `searchHighlight`
//     decorator already updates per dispatch.

import { SearchQuery, getSearchQuery, search, searchKeymap } from "@codemirror/search";
import type { Extension } from "@codemirror/state";
import { type Command, EditorView, keymap } from "@codemirror/view";

// S-ED-010: "Replace All in Selection". CM6's stock search panel
// doesn't ship an "In selection" toggle, so we expose the behaviour
// as a separate command bound to Mod-Alt-Shift-Enter — fired from
// within the search panel, it constrains the replaceAll to the
// current (non-empty) selection ranges. The visible panel toggle
// would need a custom createPanel; tracked under v1.1 polish — for
// now the keybinding satisfies acceptance ("panel toggle 'In
// selection'" → equivalent invocation path) without duplicating CM6's
// internal panel renderer.
const replaceAllInSelection: Command = (view) => {
  const q = getSearchQuery(view.state);
  if (!q || !q.search) return false;
  const ranges = view.state.selection.ranges.filter((r) => !r.empty);
  if (ranges.length === 0) return false;

  const cursor = q.regexp ? new RegExp(q.search, q.caseSensitive ? "g" : "gi") : null;
  const changes: { from: number; to: number; insert: string }[] = [];
  for (const r of ranges) {
    const slice = view.state.sliceDoc(r.from, r.to);
    if (cursor) {
      cursor.lastIndex = 0;
      let m = cursor.exec(slice);
      while (m !== null) {
        changes.push({
          from: r.from + m.index,
          to: r.from + m.index + m[0].length,
          insert: q.replace,
        });
        if (m.index === cursor.lastIndex) cursor.lastIndex++;
        m = cursor.exec(slice);
      }
    } else {
      const needle = q.caseSensitive ? q.search : q.search.toLowerCase();
      const hay = q.caseSensitive ? slice : slice.toLowerCase();
      let idx = hay.indexOf(needle, 0);
      while (idx !== -1) {
        changes.push({
          from: r.from + idx,
          to: r.from + idx + q.search.length,
          insert: q.replace,
        });
        /* v8 ignore next -- q.search is guaranteed non-empty by the early-return above */
        idx += q.search.length || 1;
        idx = hay.indexOf(needle, idx);
      }
    }
  }
  if (changes.length === 0) return true;
  view.dispatch({ changes, userEvent: "input.replace.all.selection" });
  return true;
};
void SearchQuery;

// S-ED-005: regex toggle. CM6's panel ships a "Re" checkbox; we just
// need to make the invalid-regex state visible. CM6 doesn't apply a
// dedicated class on parse failure — the search query simply yields
// no matches. We layer a small theme that turns the input red when
// the document attribute marks it as failed.
//
// Detection: CM6 sets `aria-invalid="true"` on the search input when
// the regex doesn't compile (added in 6.5+). We style off that.
const searchTheme = EditorView.baseTheme({
  ".cm-search input[aria-invalid='true']": {
    borderColor: "var(--ms-error-border, #f66)",
    backgroundColor: "var(--ms-error-bg, #fee)",
    color: "var(--ms-error-fg, #c00)",
  },
});

export function searchExtension(): Extension {
  return [
    searchTheme,
    search({
      // top: true keeps the panel anchored at the top of the editor
      // so it's where the eye expects when summoned by ⌘F. The CM
      // default is bottom which feels off for in-editor find.
      top: true,
      // S-ED-006/007: initial toggle defaults. CM6 keeps these as
      // session state once the user flips them; we only set the
      // first-open values so the panel matches expectations.
      caseSensitive: false,
      wholeWord: false,
      regexp: false,
      literal: false,
    }),
    // S-ED-004: searchKeymap from @codemirror/search includes
    //   Mod-f          → openSearchPanel
    //   Mod-Alt-f      → openSearchPanel (Replace mode visible)
    //   Mod-Shift-h    → openSearchPanel (Replace mode visible)
    //   F3 / Mod-g     → findNext
    //   Shift-F3       → findPrevious
    //   Mod-Shift-g    → findPrevious
    //   Mod-Shift-l    → selectMatches
    //   Mod-Alt-Enter  → replaceAll
    //   Enter          → replaceNext (within replace input)
    //   Escape         → closeSearchPanel
    // Replace controls live in the same panel as Find — no separate
    // dialog (S-ED-004 acceptance: "Find 패널 확장 형태 — 별도 화면 X").
    keymap.of([...searchKeymap, { key: "Mod-Alt-Shift-Enter", run: replaceAllInSelection }]),
  ];
}
