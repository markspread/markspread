// S-ED-011: autocompletion. Markdown markup completions ("# ", "- ",
// "> ", "```") plus a hook for plugins to register additional sources.
//
// Acceptance:
//   • no auto-trigger key — completion only fires on explicit ⌃Space
//     (acceptance: "트리거 키 미설정")
//   • plugins can register additional sources (acceptance: "플러그인이
//     source 추가 가능")

import {
  type CompletionContext,
  type CompletionResult,
  type CompletionSource,
  autocompletion,
  completionKeymap,
} from "@codemirror/autocomplete";
import type { Extension } from "@codemirror/state";
import { keymap } from "@codemirror/view";

const MARKDOWN_KEYWORDS: { label: string; detail: string }[] = [
  { label: "# ", detail: "H1" },
  { label: "## ", detail: "H2" },
  { label: "### ", detail: "H3" },
  { label: "- ", detail: "list item" },
  { label: "* ", detail: "list item" },
  { label: "1. ", detail: "ordered list" },
  { label: "> ", detail: "blockquote" },
  { label: "```", detail: "code block" },
  { label: "---", detail: "horizontal rule" },
];

const markdownKeywordSource: CompletionSource = (
  ctx: CompletionContext,
): CompletionResult | null => {
  // Only fire when explicitly invoked (⌃Space). The default
  // autocompletion config has activateOnTyping: false set below, so
  // ctx.explicit will be true on every fire — but we also defend
  // here in case a future caller flips the option.
  if (!ctx.explicit) return null;
  const word = ctx.matchBefore(/[#>*`\-]+\s*/);
  const from = word ? word.from : ctx.pos;
  return {
    from,
    options: MARKDOWN_KEYWORDS.map((k) => ({
      label: k.label,
      detail: k.detail,
      type: "keyword",
    })),
    validFor: /^[#>*`\- ]*$/,
  };
};

// Plugin sources are registered by `addCompletionSource(src)` and
// merged in at extension build time. v1 plugins call this on
// activation; the autocompletion array is read by reference by the
// extension we construct here.
const pluginSources: CompletionSource[] = [];

export function addCompletionSource(src: CompletionSource): () => void {
  pluginSources.push(src);
  return () => {
    const i = pluginSources.indexOf(src);
    if (i >= 0) pluginSources.splice(i, 1);
  };
}

export function autocompletionExtension(): Extension {
  return [
    autocompletion({
      activateOnTyping: false,
      override: [markdownKeywordSource, ...pluginSources],
    }),
    keymap.of(completionKeymap),
  ];
}
