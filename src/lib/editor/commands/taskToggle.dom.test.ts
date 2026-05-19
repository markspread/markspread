import "../extensions/jsdomLayoutShim";
// S-MD-028: tests for task-checkbox toggle.

import { EditorSelection, EditorState, type EditorStateConfig } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { describe, expect, it } from "vitest";
import { applyTaskToggle, toggleTaskAtCursor } from "./taskToggle";

function mount(doc: string, selection?: NonNullable<EditorStateConfig["selection"]>): EditorView {
  return new EditorView({
    state: EditorState.create({
      doc,
      ...(selection ? { selection } : {}),
      extensions: [EditorState.allowMultipleSelections.of(true)],
    }),
  });
}

describe("toggleTaskAtCursor", () => {
  it("checks an unchecked task on the cursor line", () => {
    const view = mount("- [ ] todo", { anchor: 8 });
    expect(toggleTaskAtCursor(view)).toBe(true);
    expect(view.state.doc.toString()).toBe("- [x] todo");
    view.destroy();
  });

  it("unchecks a checked task", () => {
    const view = mount("- [x] done", { anchor: 8 });
    expect(toggleTaskAtCursor(view)).toBe(true);
    expect(view.state.doc.toString()).toBe("- [ ] done");
    view.destroy();
  });

  it("handles uppercase X as checked", () => {
    const view = mount("- [X] done", { anchor: 8 });
    toggleTaskAtCursor(view);
    expect(view.state.doc.toString()).toBe("- [ ] done");
    view.destroy();
  });

  it("returns false when no cursor sits on a task line", () => {
    const view = mount("plain text", { anchor: 3 });
    expect(toggleTaskAtCursor(view)).toBe(false);
    expect(view.state.doc.toString()).toBe("plain text");
    view.destroy();
  });

  it("supports indented tasks and * / + markers", () => {
    const view = mount("  * [ ] x", { anchor: 0 });
    toggleTaskAtCursor(view);
    expect(view.state.doc.toString()).toBe("  * [x] x");
    view.destroy();
  });

  it("toggles multiple cursor lines in one transaction", () => {
    const doc = "- [ ] a\n- [ ] b\nplain";
    const view = mount(
      doc,
      EditorSelection.create([
        EditorSelection.cursor(2),
        EditorSelection.cursor(10),
        EditorSelection.cursor(18),
      ]),
    );
    expect(toggleTaskAtCursor(view)).toBe(true);
    expect(view.state.doc.toString()).toBe("- [x] a\n- [x] b\nplain");
    view.destroy();
  });
});

describe("applyTaskToggle", () => {
  it("returns a ChangeSpec when the line matches", () => {
    const state = EditorState.create({ doc: "- [ ] a\n- [ ] b" });
    const result = applyTaskToggle(state, {
      lineIndex: 1,
      oldLength: 7,
      nextLine: "- [x] b",
    });
    expect(result).not.toBeNull();
    expect(result?.changes.insert).toBe("- [x] b");
    expect(result?.userEvent).toBe("input.task.toggle.preview");
  });

  it("returns null for an out-of-range line index", () => {
    const state = EditorState.create({ doc: "only" });
    expect(applyTaskToggle(state, { lineIndex: 5, oldLength: 4, nextLine: "x" })).toBeNull();
    expect(applyTaskToggle(state, { lineIndex: -1, oldLength: 4, nextLine: "x" })).toBeNull();
  });

  it("returns null when the line length no longer matches (raced)", () => {
    const state = EditorState.create({ doc: "- [ ] a" });
    expect(applyTaskToggle(state, { lineIndex: 0, oldLength: 99, nextLine: "x" })).toBeNull();
  });
});
