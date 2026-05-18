// S-MD-047 / S-MD-048: highlight + fold the leading YAML
// frontmatter block.
//
// We register a foldService that returns a range covering the
// `---…---` fence whenever the cursor sits on the opening line, and
// pre-fold it on EditorView startup so the default state is
// "frontmatter collapsed" (S-MD-048 acceptance bullet 2).
//
// Highlight comes via lang-markdown's stock frontmatter parser when
// the GFM parser is configured with `frontmatter: true`; we don't
// duplicate that work here.

import { foldEffect, foldService } from "@codemirror/language";
import type { Extension } from "@codemirror/state";
import { EditorView } from "@codemirror/view";

const FENCE_RE = /^---\s*\r?\n([\s\S]*?)\r?\n---\s*(?:\r?\n|$)/;

const frontmatterFoldService = foldService.of((state, lineStart) => {
  if (lineStart !== 0) return null;
  const head = state.sliceDoc(0, Math.min(state.doc.length, 4096));
  const m = FENCE_RE.exec(head);
  if (!m) return null;
  // Fold from the end of the opening `---` line through to (and
  // including) the closing `---` line.
  const firstNl = head.indexOf("\n");
  return { from: firstNl, to: m[0].length - 1 };
});

const autoFoldOnInit = EditorView.updateListener.of((u) => {
  // Only act on the first composition transaction post-mount.
  if (!u.docChanged) return;
  const head = u.state.sliceDoc(0, Math.min(u.state.doc.length, 4096));
  const m = FENCE_RE.exec(head);
  if (!m) return;
  // Avoid re-folding if the user expanded it back: only fold on the
  // very first matching update we ever observe.
  if (sessionFolded.has(u.view)) return;
  sessionFolded.add(u.view);
  const firstNl = head.indexOf("\n");
  queueMicrotask(() => {
    u.view.dispatch({
      effects: foldEffect.of({ from: firstNl, to: m[0].length - 1 }),
    });
  });
});

const sessionFolded = new WeakSet<EditorView>();

export function frontmatterFoldExtension(): Extension {
  return [frontmatterFoldService, autoFoldOnInit];
}
