// S-MD-043: `:smile:` → 😀 shortcut typing.
//
// We register a CompletionSource so `:s` triggers a list of common
// names; selecting one inserts the unicode glyph. The mapping is
// shipped as a small static table; plug-ins can extend via
// `addEmojiShortcode()`. Off by default — host wires
// `setEmojiEnabled(true)` when the user opts in.

import type { CompletionContext, CompletionResult } from "@codemirror/autocomplete";
import { addCompletionSource } from "./autocompletion";

const BUILTIN: Record<string, string> = {
  smile: "😀",
  joy: "😂",
  heart: "❤️",
  thumbsup: "👍",
  thumbsdown: "👎",
  fire: "🔥",
  rocket: "🚀",
  tada: "🎉",
  warning: "⚠️",
  bug: "🐛",
  sparkles: "✨",
  eyes: "👀",
  white_check_mark: "✅",
  x: "❌",
  question: "❓",
  bulb: "💡",
  hammer: "🔨",
  wrench: "🔧",
  lock: "🔒",
  key: "🔑",
};

const extra: Record<string, string> = {};

export function addEmojiShortcode(name: string, glyph: string): void {
  extra[name] = glyph;
}

let enabled = false;
export function setEmojiEnabled(on: boolean): void {
  enabled = on;
}

const TRIGGER_RE = /:([\w+_-]*)$/;

function emojiCompletion(context: CompletionContext): CompletionResult | null {
  if (!enabled) return null;
  const line = context.state.doc.lineAt(context.pos);
  const before = line.text.slice(0, context.pos - line.from);
  const m = TRIGGER_RE.exec(before);
  if (!m) return null;
  const all = { ...BUILTIN, ...extra };
  return {
    from: line.from + (context.pos - line.from - m[0].length),
    to: context.pos,
    options: Object.entries(all).map(([name, glyph]) => ({
      label: `:${name}:`,
      detail: glyph,
      apply: glyph,
      type: "constant",
    })),
    validFor: /^:[\w+_-]*$/,
  };
}

addCompletionSource(emojiCompletion);
