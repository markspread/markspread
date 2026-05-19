import "./jsdomLayoutShim";
// S-ED-031..033: tests for multicursor commands.

import { EditorState, type EditorStateConfig } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { describe, expect, it } from "vitest";
import { multicursorExtension, selectNextOccurrence, selectSelectionMatches } from "./multicursor";

function mount(doc: string, selection: NonNullable<EditorStateConfig["selection"]>): EditorView {
  return new EditorView({
    state: EditorState.create({
      doc,
      selection,
      extensions: [EditorState.allowMultipleSelections.of(true), multicursorExtension()],
    }),
  });
}

describe("selectNextOccurrence", () => {
  it("expands an empty selection to the surrounding word", () => {
    const view = mount("foo bar foo", { anchor: 1 });
    selectNextOccurrence(view);
    const main = view.state.selection.main;
    expect(view.state.sliceDoc(main.from, main.to)).toBe("foo");
    view.destroy();
  });

  it("adds the next match as an extra selection range", () => {
    const view = mount("foo foo foo", { anchor: 0, head: 3 });
    selectNextOccurrence(view);
    expect(view.state.selection.ranges.length).toBeGreaterThan(1);
    view.destroy();
  });
});

describe("selectSelectionMatches", () => {
  it("selects every occurrence of the selected text", () => {
    const view = mount("x y x y x", { anchor: 0, head: 1 });
    selectSelectionMatches(view);
    expect(view.state.selection.ranges.length).toBe(3);
    view.destroy();
  });
});

describe("multicursorExtension", () => {
  it("is a valid extension array", () => {
    expect(Array.isArray(multicursorExtension())).toBe(true);
  });
});
