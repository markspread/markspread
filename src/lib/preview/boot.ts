// SC-BASE-02 / SC-BASE-05: production wiring for the preview pipeline's
// heavy renderers. The modules in this folder are host-agnostic —
// mermaid.ts and shiki.ts only *consume* a renderer/highlighter that a
// host registers. This module is that host registration; main.tsx
// imports it lazily after first paint so neither library taxes startup.

import { setMermaidRenderer } from "./mermaid";
import { configureShiki } from "./shiki";

type MermaidApi = typeof import("mermaid")["default"];

// Mermaid (~600KB) stays off the boot path entirely: the registered
// renderer closure dynamic-imports it on the first diagram actually
// encountered, then memoises the module for the rest of the session.
let mermaidPromise: Promise<MermaidApi | null> | null = null;

function loadMermaid(): Promise<MermaidApi | null> {
  if (!mermaidPromise) {
    mermaidPromise = import("mermaid")
      .then((m) => {
        // startOnLoad off — mermaid.ts drives rendering explicitly.
        // securityLevel strict: diagram output bypasses sanitizeHtml
        // (mermaid.ts injects the SVG directly), so mermaid's own label
        // sanitiser must stay on.
        m.default.initialize({ startOnLoad: false, securityLevel: "strict" });
        return m.default;
      })
      .catch(() => null);
  }
  return mermaidPromise;
}

// Grammars pre-warmed at configure time; highlightCode() lazy-loads any
// other language on demand (shiki.ts loadLanguage path). Dual themes emit
// `--shiki-light`/`--shiki-dark` token vars; styles.css picks the side
// matching the active app theme (S-PR-022).
const SHIKI_LANGS = [
  "bash",
  "css",
  "html",
  "javascript",
  "json",
  "markdown",
  "python",
  "rust",
  "typescript",
];

export function bootPreviewRuntime(): void {
  setMermaidRenderer(async (source, id) => {
    const mermaid = await loadMermaid();
    // Bundle missing → null: mermaid.ts keeps the plain-text fallback.
    if (!mermaid) return null;
    return mermaid.render(id, source);
  });
  // configureShiki starts the async highlighter load; until it settles,
  // highlightCode() serves the escaped <pre><code> fallback.
  void configureShiki({
    themes: { light: "github-light", dark: "github-dark" },
    langs: SHIKI_LANGS,
  });
}
