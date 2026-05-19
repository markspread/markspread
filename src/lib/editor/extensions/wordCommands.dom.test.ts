import "./jsdomLayoutShim";
// S-ED-039/040: tests for word-granular cursor & delete.

import { EditorState } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { describe, expect, it } from "vitest";
import { findKeymapCommand } from "./keymapTestUtil";
import { wordCommandsExtension } from "./wordCommands";

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
