// S-ED-061: CodeMirror theme that defers to the app's CSS custom
// properties so the editor follows whatever the shell decides
// (system + manual override + future per-workspace skins). Doing the
// work in CSS rather than JS means a `data-theme` flip on <html>
// re-paints the editor with no transaction or remount.

import { EditorView } from "@codemirror/view";
import type { Extension } from "@codemirror/state";

export function appThemeExtension(): Extension {
  return EditorView.theme({
    "&": {
      color: "var(--color-fg)",
      backgroundColor: "var(--color-bg)",
      height: "100%",
    },
    ".cm-scroller": {
      fontFamily: "inherit",
      lineHeight: "inherit",
    },
    ".cm-content": {
      // S-ED-062: prose-like body padding so reviewers don't read against
      // the gutter edge. Padding lives on .cm-content (not .cm-scroller)
      // so the gutter sits flush against the sidebar — moving it to the
      // scroller pushed the fold chevrons right and made them look
      // disconnected from the file tree.
      // S-ED-063: cap measure at ~80ch so long-line markdown reads as prose
      // rather than as a code spill. Soft-wrap is on by default so this
      // bounds the visual width even when the doc has long paragraphs.
      padding: "1.25rem clamp(1rem, 6vw, 4rem)",
      maxWidth: "80ch",
      margin: "0 auto",
      caretColor: "var(--color-fg)",
    },
    ".cm-gutters": {
      backgroundColor: "var(--color-surface-subtle)",
      color: "var(--color-muted)",
      borderRight: "1px solid var(--color-border)",
    },
    ".cm-activeLineGutter, .cm-activeLine": {
      backgroundColor:
        "color-mix(in oklab, var(--color-accent) 8%, transparent)",
    },
    ".cm-cursor, .cm-dropCursor": {
      borderLeftColor: "var(--color-fg)",
    },
    "&.cm-focused .cm-selectionBackground, ::selection": {
      backgroundColor:
        "color-mix(in oklab, var(--color-accent) 30%, transparent)",
    },
    ".cm-selectionMatch": {
      backgroundColor:
        "color-mix(in oklab, var(--color-accent) 18%, transparent)",
    },
    ".cm-panels": {
      backgroundColor: "var(--color-surface)",
      color: "var(--color-fg)",
      borderTop: "1px solid var(--color-border)",
    },
    ".cm-tooltip": {
      backgroundColor: "var(--color-surface)",
      color: "var(--color-fg)",
      border: "1px solid var(--color-border)",
    },
    ".cm-foldPlaceholder": {
      backgroundColor: "var(--color-surface-subtle)",
      color: "var(--color-muted)",
      border: "1px solid var(--color-border)",
      padding: "0 0.4em",
      borderRadius: "3px",
    },
  });
}
