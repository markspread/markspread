// S-ED-015..S-ED-030: editor settings bridge. We use Compartments for
// every toggle/numeric setting so the user can flip them at runtime
// without recreating the EditorView (which would lose cursor +
// selection + undo).
//
// Each setting owns a compartment + a "build extensions for this
// value" function. `reconfigureFromSettings(view, prefs)` walks the
// compartments and dispatches a single transaction with an effect per
// changed compartment.

import { indentUnit } from "@codemirror/language";
import { Compartment, EditorState, type Extension } from "@codemirror/state";
import { EditorView } from "@codemirror/view";

import { lineNumberClickExtension } from "./extensions/lineNumberClick";

export interface EditorPrefs {
  showLineNumbers: boolean; // S-ED-015
  // S-ED-025/026
  indentWithTabs: boolean;
  indentSize: number; // 2 or 4
  tabSize: number; // visual width when indentWithTabs
  // S-ED-027
  softWrap: boolean;
  // S-ED-028..030
  fontFamily: string;
  fontSize: number; // px
  lineHeight: number; // multiplier (1.4, 1.6, ...)
}

// S-ED-014: defaults tuned for the "non-developer markdown reviewer" use
// case. Code-editor cues (line numbers, mono body) are off; the editor
// renders prose with a sans body so headings, lists, and emphasis read
// like a document. Power users still get one-click toggles via the
// settings panel + the keymap.
export const DEFAULT_EDITOR_PREFS: EditorPrefs = {
  showLineNumbers: false,
  indentWithTabs: false,
  indentSize: 2,
  tabSize: 4,
  softWrap: true,
  fontFamily:
    'Inter Variable, "Inter", "Pretendard Variable", "Pretendard", system-ui, -apple-system, "Segoe UI", "Apple SD Gothic Neo", "Noto Sans KR", sans-serif',
  fontSize: 15,
  lineHeight: 1.7,
};

const compartments = {
  lineNumbers: new Compartment(),
  indent: new Compartment(),
  tabSize: new Compartment(),
  softWrap: new Compartment(),
  appearance: new Compartment(),
};

function buildLineNumbers(p: EditorPrefs): Extension {
  // S-ED-056 lives inside this compartment so toggling line numbers
  // off/on at runtime keeps the click-to-select-line behaviour.
  return p.showLineNumbers ? lineNumberClickExtension() : [];
}

function buildIndentUnit(p: EditorPrefs): Extension {
  // CM6's indentUnit facet takes the literal characters inserted on
  // Tab / auto-indent. Tab → "\t"; spaces → " " repeated N times.
  const unit = p.indentWithTabs ? "\t" : " ".repeat(p.indentSize);
  return indentUnit.of(unit);
}

function buildTabSize(p: EditorPrefs): Extension {
  // S-ED-026: clamp to 1..8. Sub-1 visual width breaks the gutter
  // alignment; >8 is effectively a wall and almost certainly a typo.
  const clamped = Math.min(8, Math.max(1, Math.floor(p.tabSize)));
  return EditorState.tabSize.of(clamped);
}

function buildSoftWrap(p: EditorPrefs): Extension {
  return p.softWrap ? EditorView.lineWrapping : [];
}

function buildAppearance(p: EditorPrefs): Extension {
  // S-ED-029: clamp font size 8..32px so a runaway settings entry
  // doesn't render an unusable editor.
  const fontSize = Math.min(32, Math.max(8, Math.round(p.fontSize)));
  // S-ED-030: clamp line-height 1.0..2.0 (spec).
  const lineHeight = Math.min(2.0, Math.max(1.0, p.lineHeight));
  return EditorView.theme({
    "&": {
      fontFamily: p.fontFamily,
      fontSize: `${fontSize}px`,
      lineHeight: String(lineHeight),
    },
  });
}

/** S-ED-029: bump font size by ±1px (clamped). Returns the new size. */
export function adjustFontSize(view: EditorView, prefs: EditorPrefs, delta: number): number {
  const next = { ...prefs, fontSize: prefs.fontSize + delta };
  view.dispatch({
    effects: compartments.appearance.reconfigure(buildAppearance(next)),
  });
  // The clamp lives inside buildAppearance; reflect it back to the
  // caller so the persisted prefs match what the user sees.
  return Math.min(32, Math.max(8, Math.round(next.fontSize)));
}

/**
 * The compartment-wrapped extensions to include on initial mount.
 * Pass the current prefs so the first render reflects them; later
 * changes go through reconfigureFromSettings.
 */
export function settingsExtensions(prefs: EditorPrefs): Extension {
  return [
    compartments.lineNumbers.of(buildLineNumbers(prefs)),
    compartments.indent.of(buildIndentUnit(prefs)),
    compartments.tabSize.of(buildTabSize(prefs)),
    compartments.softWrap.of(buildSoftWrap(prefs)),
    compartments.appearance.of(buildAppearance(prefs)),
  ];
}

/**
 * S-ED-027: toggle soft-wrap in place. We dispatch a single
 * reconfigure for the softWrap compartment — the rest of the prefs
 * carry forward. The caller should mirror the new state into the
 * persisted prefs so a reload keeps the choice (acceptance: 설정 영속).
 */
export function toggleSoftWrap(view: EditorView, prefs: EditorPrefs): boolean {
  const next = { ...prefs, softWrap: !prefs.softWrap };
  view.dispatch({
    effects: compartments.softWrap.reconfigure(buildSoftWrap(next)),
  });
  return next.softWrap;
}

export function reconfigureFromSettings(view: EditorView, prefs: EditorPrefs): void {
  view.dispatch({
    effects: [
      compartments.lineNumbers.reconfigure(buildLineNumbers(prefs)),
      compartments.indent.reconfigure(buildIndentUnit(prefs)),
      compartments.tabSize.reconfigure(buildTabSize(prefs)),
      compartments.softWrap.reconfigure(buildSoftWrap(prefs)),
      compartments.appearance.reconfigure(buildAppearance(prefs)),
    ],
  });
}
