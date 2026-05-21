import "./jsdomLayoutShim";
// S-ED-039/040: tests for word-granular cursor & delete.

import { EditorState } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { describe, expect, it } from "vitest";
import { findKeymapCommand } from "./keymapTestUtil";
import { currentLocale, wordCommandsExtension } from "./wordCommands";

const commandFor = (key: string) => findKeymapCommand(wordCommandsExtension(), key);

function mount(doc: string, head: number): EditorView {
  return new EditorView({
    state: EditorState.create({ doc, selection: { anchor: head } }),
  });
}

describe("word cursor commands", () => {
  it("moves the caret to the next word boundary", () => {
    const view = mount("hello world", 0);
    commandFor("Alt-ArrowRight")(view);
    expect(view.state.selection.main.head).toBeGreaterThan(0);
    view.destroy();
  });

  it("moves the caret to the previous word boundary", () => {
    const view = mount("hello world", 11);
    commandFor("Alt-ArrowLeft")(view);
    expect(view.state.selection.main.head).toBeLessThan(11);
    view.destroy();
  });
});

describe("word delete commands", () => {
  it("deletes the word before the caret", () => {
    const view = mount("hello world", 11);
    expect(commandFor("Alt-Backspace")(view)).toBe(true);
    expect(view.state.doc.toString()).toBe("hello ");
    view.destroy();
  });

  it("deletes the word after the caret", () => {
    const view = mount("hello world", 0);
    expect(commandFor("Alt-Delete")(view)).toBe(true);
    expect(view.state.doc.toString().length).toBeLessThan("hello world".length);
    view.destroy();
  });

  it("collapses a non-empty selection on delete", () => {
    const view = new EditorView({
      state: EditorState.create({
        doc: "abc def",
        selection: { anchor: 0, head: 3 },
      }),
    });
    expect(commandFor("Alt-Backspace")(view)).toBe(true);
    expect(view.state.doc.toString()).toBe(" def");
    view.destroy();
  });

  it("returns false when there is nothing to delete forward at doc end", () => {
    const view = mount("abc", 3);
    expect(commandFor("Alt-Delete")(view)).toBe(false);
    view.destroy();
  });
});

describe("currentLocale", () => {
  it("honours the html lang attribute when present", () => {
    const original = document.documentElement.lang;
    document.documentElement.lang = "ja-JP";
    try {
      expect(currentLocale()).toBe("ja-JP");
    } finally {
      document.documentElement.lang = original;
    }
  });

  it("falls back to navigator.language when the html lang is empty", () => {
    const original = document.documentElement.lang;
    document.documentElement.lang = "";
    try {
      expect(typeof currentLocale()).toBe("string");
    } finally {
      document.documentElement.lang = original;
    }
  });
});

describe("fallback when Intl.Segmenter is unavailable", () => {
  it("falls back to group commands for cursor and delete", () => {
    const original = (Intl as unknown as { Segmenter?: unknown }).Segmenter;
    (Intl as unknown as { Segmenter?: unknown }).Segmenter = undefined;
    try {
      const v1 = mount("hello world", 0);
      expect(commandFor("Alt-ArrowRight")(v1)).toBe(true);
      expect(v1.state.selection.main.head).toBeGreaterThan(0);
      v1.destroy();

      const v2 = mount("hello world", 11);
      expect(commandFor("Alt-ArrowLeft")(v2)).toBe(true);
      expect(v2.state.selection.main.head).toBeLessThan(11);
      v2.destroy();

      const v3 = mount("hello world", 11);
      expect(commandFor("Alt-Backspace")(v3)).toBe(true);
      expect(v3.state.doc.toString().length).toBeLessThan("hello world".length);
      v3.destroy();

      const v4 = mount("hello world", 0);
      expect(commandFor("Alt-Delete")(v4)).toBe(true);
      expect(v4.state.doc.toString().length).toBeLessThan("hello world".length);
      v4.destroy();
    } finally {
      (Intl as unknown as { Segmenter?: unknown }).Segmenter = original;
    }
  });
});
