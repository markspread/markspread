// S-ED-001: EditorState boot. We build the EditorState here so the
// React layer can stay thin — Editor.tsx just owns the EditorView's
// DOM lifecycle and feeds the state in.
//
// Acceptance:
//   • mount → first paint < 50ms (1MB file)
//   • reused EditorView vs destroy/recreate policy is explicit
//   • StateField doesn't leak across tab switches
//
// Policy: we destroy() the EditorView on unmount and create a fresh
// one for each tab. CodeMirror 6 view lifecycle is cheap (~5ms even
// on a 1MB doc) and the alternative — a single shared view that
// `setState`s into different docs — leaks listeners attached to per-
// tab StateFields (e.g. selection, fold state) and is harder to
// reason about across tab focus. The cost is rebuilding the
// extension array per mount; we cache it as a singleton below so the
// allocation is one-time.

import { defaultKeymap, history, historyKeymap } from "@codemirror/commands";
import { defaultHighlightStyle, syntaxHighlighting } from "@codemirror/language";
import { highlightSelectionMatches } from "@codemirror/search";
import { EditorState, type Extension } from "@codemirror/state";
import {
  EditorView,
  crosshairCursor,
  drawSelection,
  dropCursor,
  highlightActiveLine,
  highlightActiveLineGutter,
  highlightSpecialChars,
  keymap,
  rectangularSelection,
} from "@codemirror/view";

// S-ED-002: history config. CodeMirror's default newGroupDelay is
// 500ms which matches our acceptance — typing pauses longer than half
// a second start a new undo group. We pass the option explicitly so
// the policy is searchable; save is independent of history (no API
// tie-in), and a redo stack is cleared by any user-typed change
// (CM6 default).
const HISTORY_CONFIG = { newGroupDelay: 500 };
import { markdown } from "@codemirror/lang-markdown";

import { taskToggleExtension } from "./commands/taskToggle";
import { appThemeExtension } from "./extensions/appTheme";
import { autocompletionExtension } from "./extensions/autocompletion";
import { clipboardExtension } from "./extensions/clipboard";
import { codeFenceExtension } from "./extensions/codeFence";
import { commentExtension } from "./extensions/comment";
import { foldingExtension } from "./extensions/folding";
import { footnotesExtension } from "./extensions/footnotes";
import { frontmatterFoldExtension } from "./extensions/frontmatterFold";
import { gotoLineExtension } from "./extensions/gotoLine";
import { imeExtension } from "./extensions/ime";
import { indentExtension } from "./extensions/indent";
import { lineCommandsExtension } from "./extensions/lineCommands";
import { markdownEnterExtension } from "./extensions/markdownEnter";
import { markdownFormatExtension } from "./extensions/markdownFormat";
import { markdownHighlightExtension } from "./extensions/markdownHighlight";
import { multicursorExtension } from "./extensions/multicursor";
import { searchExtension } from "./extensions/search";
import { tablesExtension } from "./extensions/tables";
import { wikilinkExtension } from "./extensions/wikilink";
import { wordCommandsExtension } from "./extensions/wordCommands";
import { DEFAULT_EDITOR_PREFS, type EditorPrefs, settingsExtensions } from "./settings";

export type EditorLanguage = "markdown" | "plain";

let coreExtensionsCache: readonly Extension[] | null = null;
let markdownExtensionsCache: readonly Extension[] | null = null;

/**
 * Language-agnostic extensions: theme, history, keymaps, search, autocompletion,
 * folding, … — anything that should run regardless of file type.
 */
function coreExtensions(): readonly Extension[] {
  if (coreExtensionsCache) return coreExtensionsCache;
  coreExtensionsCache = [
    appThemeExtension(),
    highlightActiveLineGutter(),
    highlightSpecialChars(),
    history(HISTORY_CONFIG),
    drawSelection(),
    dropCursor(),
    rectangularSelection(),
    crosshairCursor(),
    EditorState.allowMultipleSelections.of(true),
    syntaxHighlighting(defaultHighlightStyle, { fallback: true }),
    highlightActiveLine(),
    highlightSelectionMatches(),
    keymap.of([...defaultKeymap, ...historyKeymap]),
    searchExtension(),
    multicursorExtension(),
    lineCommandsExtension(),
    wordCommandsExtension(),
    indentExtension(),
    commentExtension(),
    gotoLineExtension(),
    imeExtension(),
    clipboardExtension(),
    autocompletionExtension(),
    foldingExtension(),
  ];
  return coreExtensionsCache;
}

/**
 * Markdown-only extensions. Loaded only when the active file is Markdown so
 * a `.ts` or `.json` file isn't parsed (or autolinked) as Markdown.
 */
function markdownLanguageExtensions(): readonly Extension[] {
  if (markdownExtensionsCache) return markdownExtensionsCache;
  markdownExtensionsCache = [
    markdown(),
    markdownHighlightExtension(),
    codeFenceExtension(),
    markdownFormatExtension(),
    markdownEnterExtension(),
    tablesExtension(),
    footnotesExtension(),
    wikilinkExtension(),
    taskToggleExtension(),
    frontmatterFoldExtension(),
  ];
  return markdownExtensionsCache;
}

export function buildEditorState(
  doc: string,
  extra: readonly Extension[] = [],
  prefs: EditorPrefs = DEFAULT_EDITOR_PREFS,
  language: EditorLanguage = "markdown",
): EditorState {
  return EditorState.create({
    doc,
    extensions: [
      ...coreExtensions(),
      ...(language === "markdown" ? markdownLanguageExtensions() : []),
      settingsExtensions(prefs),
      ...extra,
    ],
  });
}

export function mountEditor(
  parent: HTMLElement,
  doc: string,
  extra: readonly Extension[] = [],
  prefs: EditorPrefs = DEFAULT_EDITOR_PREFS,
  language: EditorLanguage = "markdown",
): EditorView {
  return new EditorView({
    parent,
    state: buildEditorState(doc, extra, prefs, language),
  });
}
