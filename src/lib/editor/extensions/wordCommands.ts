// S-ED-039 / S-ED-040: word-granular cursor & delete.
//
// CM6 ships `cursorGroupLeft/Right` and `deleteGroupBackward/Forward`,
// but they operate on character categories (letter / digit / space /
// punctuation). That works well for Latin/Hangul (Korean inserts
// spaces between 어절, so the space class catches every boundary), but
// breaks down for Japanese/Chinese where text has no inter-word
// whitespace — every kana/kanji becomes its own "word", which is
// nothing like what the user expects when they hit ⌥→.
//
// Acceptance (S-ED-039): "CJK 단어 경계는 ICU segmenter 활용 (가능 시)".
// We use `Intl.Segmenter(locale, { granularity: "word" })` which is
// the spec-blessed ICU bridge in modern engines (Chromium 87+, WebKit
// 14.1+, Tauri's webview is always recent enough). When it isn't
// available, we fall back to CM6's stock group commands.
//
// Locale detection: we honour `document.documentElement.lang`; the i18n
// layer (S-IL-001) sets it on language switch. If unset, we fall back
// to navigator.language. Either way the segmenter yields sensible
// boundaries for Latin/CJK/Hangul.

import {
  cursorGroupLeft,
  cursorGroupRight,
  deleteGroupBackward,
  deleteGroupForward,
} from "@codemirror/commands";
import { keymap, type Command } from "@codemirror/view";
import { EditorSelection, type Extension } from "@codemirror/state";

const HasSegmenter =
  typeof Intl !== "undefined" &&
  typeof (Intl as unknown as { Segmenter?: unknown }).Segmenter === "function";

function currentLocale(): string {
  if (typeof document !== "undefined") {
    const lang = document.documentElement.lang;
    if (lang) return lang;
  }
  if (typeof navigator !== "undefined" && navigator.language) {
    return navigator.language;
  }
  return "en";
}

// We segment a window around the cursor (256 chars on each side) so
// we don't pay the cost of segmenting the entire document for one
// keypress. 256 is enough to find the next/prev word boundary in any
// reasonable prose; if a token is somehow longer we fall back to the
// window edge, which is what cursorGroupLeft/Right would do anyway.
const WINDOW = 256;

function findWordBoundary(
  doc: import("@codemirror/state").Text,
  from: number,
  dir: 1 | -1,
): number {
  if (!HasSegmenter) return -1;
  const segLeft = Math.max(0, from - WINDOW);
  const segRight = Math.min(doc.length, from + WINDOW);
  const slice = doc.sliceString(segLeft, segRight);
  const offset = from - segLeft;
  const seg = new (Intl as unknown as {
    Segmenter: new (
      locale: string,
      opts: { granularity: "word" },
    ) => { segment: (input: string) => Iterable<{ index: number; segment: string }> };
  }).Segmenter(currentLocale(), { granularity: "word" });
  const indices: number[] = [];
  for (const part of seg.segment(slice)) {
    indices.push(part.index);
  }
  indices.push(slice.length);
  if (dir === 1) {
    for (const i of indices) {
      if (i > offset) return segLeft + i;
    }
    return segRight;
  } else {
    let prev = 0;
    for (const i of indices) {
      if (i >= offset) return segLeft + prev;
      prev = i;
    }
    return segLeft + prev;
  }
}

function moveByWord(
  view: import("@codemirror/view").EditorView,
  dir: 1 | -1,
): boolean {
  if (!HasSegmenter) {
    return dir === 1 ? cursorGroupRight(view) : cursorGroupLeft(view);
  }
  const { state } = view;
  const next = state.selection.ranges.map((r) => {
    const target = findWordBoundary(state.doc, r.head, dir);
    return EditorSelection.cursor(target);
  });
  view.dispatch({
    selection: EditorSelection.create(next, state.selection.mainIndex),
    scrollIntoView: true,
    userEvent: "select",
  });
  return true;
}

const cursorWordLeft: Command = (view) => moveByWord(view, -1);
const cursorWordRight: Command = (view) => moveByWord(view, 1);

function deleteByWord(
  view: import("@codemirror/view").EditorView,
  dir: 1 | -1,
): boolean {
  if (!HasSegmenter) {
    return dir === 1 ? deleteGroupForward(view) : deleteGroupBackward(view);
  }
  const { state } = view;
  let changed = false;
  const tr = state.changeByRange((range) => {
    if (!range.empty) {
      changed = true;
      return {
        changes: { from: range.from, to: range.to, insert: "" },
        range: EditorSelection.cursor(range.from),
      };
    }
    const target = findWordBoundary(state.doc, range.head, dir);
    if (target === range.head) {
      return { range };
    }
    changed = true;
    const from = Math.min(target, range.head);
    const to = Math.max(target, range.head);
    return {
      changes: { from, to, insert: "" },
      range: EditorSelection.cursor(from),
    };
  });
  if (!changed) return false;
  view.dispatch(
    state.update(tr, { scrollIntoView: true, userEvent: "delete.word" }),
  );
  return true;
}

const deleteWordBackward: Command = (view) => deleteByWord(view, -1);
const deleteWordForward: Command = (view) => deleteByWord(view, 1);

export function wordCommandsExtension(): Extension {
  return keymap.of([
    // S-ED-039
    { key: "Alt-ArrowLeft", run: cursorWordLeft, preventDefault: true },
    { key: "Alt-ArrowRight", run: cursorWordRight, preventDefault: true },
    // S-ED-040
    { key: "Alt-Backspace", run: deleteWordBackward, preventDefault: true },
    { key: "Alt-Delete", run: deleteWordForward, preventDefault: true },
  ]);
}
