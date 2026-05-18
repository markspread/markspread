// S-MD-012 / S-MD-014: code-fence input helpers.
//
// S-MD-012: typing ``` (three backticks) at the start of an empty
//   line auto-pairs the closing fence three lines down and parks the
//   cursor on the inner blank line. We don't fire on every backtick —
//   only when the third tick lands on a fresh line, so users mid-
//   sentence backtick-ing through code spans aren't disrupted.
//
// S-MD-014: while the cursor is on the language hint position
//   (immediately after the opening fence), offer a completion source
//   listing common Shiki grammar names. Plugins can extend the list
//   via `addCodeLanguageCompletion()`.

import {
  type CompletionContext,
  type CompletionResult,
  startCompletion,
} from "@codemirror/autocomplete";
import { EditorSelection, type Extension } from "@codemirror/state";
import { EditorView } from "@codemirror/view";

import { addCompletionSource } from "./autocompletion";

const DEFAULT_LANGS = [
  "bash",
  "c",
  "cpp",
  "csharp",
  "css",
  "diff",
  "dockerfile",
  "go",
  "graphql",
  "html",
  "ini",
  "java",
  "javascript",
  "json",
  "kotlin",
  "markdown",
  "perl",
  "php",
  "powershell",
  "python",
  "r",
  "ruby",
  "rust",
  "scala",
  "scss",
  "shell",
  "sql",
  "swift",
  "toml",
  "tsx",
  "typescript",
  "vue",
  "xml",
  "yaml",
  "zig",
];

const customLangs: string[] = [];
export function addCodeLanguageCompletion(name: string): void {
  if (!customLangs.includes(name)) customLangs.push(name);
}

function languageList(): string[] {
  return [...DEFAULT_LANGS, ...customLangs];
}

const fenceAutoclose = EditorView.updateListener.of((u) => {
  if (!u.docChanged) return;
  let triggered: { pos: number } | null = null;
  for (const tr of u.transactions) {
    if (!tr.docChanged) continue;
    if (tr.annotation(EditorView.theme as never)) continue;
    tr.changes.iterChanges((_fromA, _toA, _fromB, toB, inserted) => {
      const text = inserted.toString();
      if (!text.endsWith("`")) return;
      const line = u.state.doc.lineAt(toB);
      if (line.text === "```" && toB === line.to) {
        triggered = { pos: toB };
      }
    });
  }
  if (triggered) {
    queueMicrotask(() => {
      const t = triggered as { pos: number };
      u.view.dispatch({
        changes: { from: t.pos, insert: "\n\n```" },
        selection: EditorSelection.cursor(t.pos + 1),
        userEvent: "input.fence.autoclose",
        scrollIntoView: true,
      });
    });
  }
});

function fenceLanguageCompletion(context: CompletionContext): CompletionResult | null {
  const line = context.state.doc.lineAt(context.pos);
  const m = /^(```)([\w+-]*)$/.exec(line.text.slice(0, context.pos - line.from));
  if (!m) return null;
  return {
    from: line.from + 3,
    options: languageList().map((l) => ({ label: l, type: "type" })),
    validFor: /^[\w+-]*$/,
  };
}

addCompletionSource(fenceLanguageCompletion);

// Auto-fire the completion popup when the user types a language
// character on a `\`\`\`` line. We don't trigger on the third backtick
// itself (the autoclose handler runs there).
const fenceLangAutotrigger = EditorView.updateListener.of((u) => {
  if (!u.docChanged) return;
  const sel = u.state.selection.main;
  if (!sel.empty) return;
  const line = u.state.doc.lineAt(sel.head);
  const before = line.text.slice(0, sel.head - line.from);
  if (/^```[\w+-]+$/.test(before)) {
    queueMicrotask(() => startCompletion(u.view));
  }
});

export function codeFenceExtension(): Extension {
  return [fenceAutoclose, fenceLangAutotrigger];
}
