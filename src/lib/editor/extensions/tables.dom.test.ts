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

  it("preserves colon alignment markers", async () => {
    const view = new EditorView({
      state: EditorState.create({
        doc: "| Header | Center | Right |\n",
        extensions: tablesExtension(),
      }),
    });
    const line2From = view.state.doc.line(2).from;
    view.dispatch({
      changes: { from: line2From, insert: "|:---|:---:|---:|" },
      selection: { anchor: line2From + 17 },
    });
    await new Promise<void>((r) => queueMicrotask(r));
    expect(view.state.doc.line(2).text).toBe("| :----- | :----: | ----: |");
    view.destroy();
  });

  it("does nothing when the line is not a separator row", () => {
    const view = new EditorView({
      state: EditorState.create({
        doc: "plain",
        extensions: tablesExtension(),
      }),
    });
    view.dispatch({ changes: { from: 5, insert: "X" } });
    expect(view.state.doc.toString()).toBe("plainX");
    view.destroy();
  });

  it("does nothing when the selection is non-empty", () => {
    const view = new EditorView({
      state: EditorState.create({
        doc: "| H |\n|---|",
        extensions: tablesExtension(),
      }),
    });
    view.dispatch({
      changes: { from: 11, insert: " " },
      selection: { anchor: 5, head: 12 },
    });
    expect(view.state.doc.line(2).text).toBe("|---| ");
    view.destroy();
  });

  it("does nothing when the separator sits on the first line (no header above)", () => {
    const view = new EditorView({
      state: EditorState.create({
        doc: "",
        extensions: tablesExtension(),
      }),
    });
    view.dispatch({
      changes: { from: 0, insert: "|---|---|" },
      selection: { anchor: 9 },
    });
    expect(view.state.doc.toString()).toBe("|---|---|");
    view.destroy();
  });

  it("ignores selection-only updates (no docChanged)", () => {
    const view = new EditorView({
      state: EditorState.create({
        doc: "| H |\n|---|",
        extensions: tablesExtension(),
      }),
    });
    view.dispatch({ selection: { anchor: 5 } });
    expect(view.state.doc.line(2).text).toBe("|---|");
    view.destroy();
  });

  it("does nothing when the previous line is not a table line", () => {
    const view = new EditorView({
      state: EditorState.create({
        doc: "plain\n",
        extensions: tablesExtension(),
      }),
    });
    view.dispatch({
      changes: { from: 6, insert: "|---|---|" },
      selection: { anchor: 15 },
    });
    expect(view.state.doc.line(2).text).toBe("|---|---|");
    view.destroy();
  });

  it("does nothing when header/separator column counts differ", () => {
    const view = new EditorView({
      state: EditorState.create({
        doc: "| A | B |\n",
        extensions: tablesExtension(),
      }),
    });
    const line2From = view.state.doc.line(2).from;
    view.dispatch({
      changes: { from: line2From, insert: "|---|---|---|" },
      selection: { anchor: line2From + 13 },
    });
    expect(view.state.doc.line(2).text).toBe("|---|---|---|");
    view.destroy();
  });

  it("does not redispatch when the separator is already pretty-formatted", async () => {
    // Triggers the `if (next === line.text) return;` branch — the
    // formatter would emit the same text it already sees, so it
    // short-circuits.
    const view = new EditorView({
      state: EditorState.create({
        doc: "| A | B |\n",
        extensions: tablesExtension(),
      }),
    });
    const line2From = view.state.doc.line(2).from;
    view.dispatch({
      changes: { from: line2From, insert: "| --- | --- |" },
      selection: { anchor: line2From + 13 },
    });
    await new Promise<void>((r) => queueMicrotask(r));
    expect(view.state.doc.line(2).text).toBe("| --- | --- |");
    view.destroy();
  });
});

describe("tableEnter (Enter) — extra branches", () => {
  const enter = commandFor("Enter");

  it("returns false when the selection is non-empty on a table line", () => {
    const view = new EditorView({
      state: EditorState.create({
        doc: "| a | b |",
        selection: { anchor: 0, head: 9 },
      }),
    });
    expect(enter(view)).toBe(false);
    view.destroy();
  });
});

describe("tablePrevCell — extra branches", () => {
  const shiftTab = commandFor("Shift-Tab");

  it("returns false when the cursor sits inside the first cell (no previous pipe)", () => {
    const view = mount("| a | b |", 1);
    expect(shiftTab(view)).toBe(false);
    view.destroy();
  });

  it("falls back to the current pipe when there is no earlier pipe (cursor just past the first pipe)", () => {
    // head=2 → loop matches at i=0 with pipes[0]=0 < head-1=1, so the
    // `pipes[i - 1] ?? pipes[i]` fallback (`?? pipes[0]`) fires.
    const view = mount("| a | b |", 2);
    expect(shiftTab(view)).toBe(true);
    view.destroy();
  });
});
