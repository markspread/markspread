import "./jsdomLayoutShim";
// S-MD-029..033: tests for GFM table input helpers.

import { EditorState, type Extension } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { describe, expect, it } from "vitest";
import { findKeymapCommand } from "./keymapTestUtil";
import { tablesExtension } from "./tables";

const commandFor = (key: string) => findKeymapCommand(tablesExtension(), key);

function mount(doc: string, head: number, ext?: Extension): EditorView {
  return new EditorView({
    state: EditorState.create({
      doc,
      selection: { anchor: head },
      extensions: ext ?? [],
    }),
  });
}

describe("tableNextCell (Tab)", () => {
  const tab = commandFor("Tab");

  it("moves the caret into the next cell", () => {
    const view = mount("| a | b |", 3);
    expect(tab(view)).toBe(true);
    expect(view.state.selection.main.head).toBe(6);
    view.destroy();
  });

  it("returns false when not on a table line", () => {
    const view = mount("plain text", 2);
    expect(tab(view)).toBe(false);
    view.destroy();
  });

  it("creates a new row when Tab is pressed on the last cell", () => {
    const view = mount("| a | b |", 8);
    expect(tab(view)).toBe(true);
    expect(view.state.doc.toString()).toBe("| a | b |\n| | |");
    view.destroy();
  });
});

describe("tablePrevCell (Shift-Tab)", () => {
  const shiftTab = commandFor("Shift-Tab");

  it("moves the caret back to the previous cell", () => {
    const view = mount("| a | b |", 7);
    expect(shiftTab(view)).toBe(true);
    expect(view.state.selection.main.head).toBeLessThan(7);
    view.destroy();
  });

  it("returns false on a non-table line", () => {
    const view = mount("nope", 2);
    expect(shiftTab(view)).toBe(false);
    view.destroy();
  });
});

describe("tableEnter (Enter)", () => {
  const enter = commandFor("Enter");

  it("appends a new row when at the end of a table line", () => {
    const view = mount("| a | b |", 9);
    expect(enter(view)).toBe(true);
    expect(view.state.doc.toString()).toBe("| a | b |\n| | |");
    view.destroy();
  });

  it("returns false when the caret is before the last pipe", () => {
    const view = mount("| a | b |", 3);
    expect(enter(view)).toBe(false);
    view.destroy();
  });

  it("returns false on a non-table line", () => {
    const view = mount("text", 2);
    expect(enter(view)).toBe(false);
    view.destroy();
  });
});

describe("tableSeparatorAutoformat", () => {
  it("pretty-pads the separator row to match header widths", async () => {
    const view = new EditorView({
      state: EditorState.create({
        doc: "| Header | X |\n",
        extensions: tablesExtension(),
      }),
    });
    const line2From = view.state.doc.line(2).from;
    view.dispatch({
      changes: { from: line2From, insert: "|---|---|" },
      selection: { anchor: line2From + 9 },
    });
    await new Promise<void>((r) => queueMicrotask(r));
    const sep = view.state.doc.line(2).text;
    expect(sep).toBe("| ------ | --- |");
    view.destroy();
  });
});
