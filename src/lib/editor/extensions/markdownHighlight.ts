// S-MD-001: heading-level visual differentiation.
//
// `defaultHighlightStyle` from @codemirror/language assigns a single
// "heading" colour to all six levels. The acceptance asks for "6단계
// 모두 색·크기 시각 차이" — so we layer a markdown-specific
// HighlightStyle that scales font-size and weight per level. The
// underlying tags (heading1..heading6) come from lezer-markdown's
// highlight wrapper.
//
// Performance: HighlightStyle compiles to ranged decorations that CM6
// applies viewport-scoped — so we only paint headings inside the
// visible window, satisfying the second acceptance bullet
// ("decoration은 viewport 단위만 적용").

import { HighlightStyle, syntaxHighlighting } from "@codemirror/language";
import type { Extension } from "@codemirror/state";
import { tags as t } from "@lezer/highlight";

const markdownHighlightStyle = HighlightStyle.define([
  { tag: t.heading1, fontSize: "1.8em", fontWeight: "700", color: "var(--ms-md-h1, #2b6cb0)" },
  { tag: t.heading2, fontSize: "1.5em", fontWeight: "700", color: "var(--ms-md-h2, #2c5282)" },
  { tag: t.heading3, fontSize: "1.3em", fontWeight: "600", color: "var(--ms-md-h3, #2a4365)" },
  { tag: t.heading4, fontSize: "1.15em", fontWeight: "600", color: "var(--ms-md-h4, #1a365d)" },
  { tag: t.heading5, fontSize: "1.05em", fontWeight: "600", color: "var(--ms-md-h5, #1a365d)" },
  { tag: t.heading6, fontSize: "1.0em", fontWeight: "600", color: "var(--ms-md-h6, #2d3748)" },
  // Inline emphasis tags get a small refresh too — defaultHighlight-
  // Style ships these but markdown documents lean on them so heavily
  // that bumping them once here saves a per-theme override.
  { tag: t.emphasis, fontStyle: "italic" },
  { tag: t.strong, fontWeight: "700" },
  { tag: t.strikethrough, textDecoration: "line-through" },
  { tag: t.link, color: "var(--ms-md-link, #3182ce)", textDecoration: "underline" },
  { tag: t.url, color: "var(--ms-md-link, #3182ce)" },
  { tag: t.monospace, fontFamily: "var(--ms-md-mono, ui-monospace, monospace)" },
  { tag: t.quote, color: "var(--ms-md-quote, #718096)", fontStyle: "italic" },
]);

export function markdownHighlightExtension(): Extension {
  return syntaxHighlighting(markdownHighlightStyle);
}
