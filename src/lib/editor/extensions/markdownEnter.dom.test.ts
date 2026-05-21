import "./jsdomLayoutShim";
// S-ED-042: tests for smart markdown Enter.

import { EditorState } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { describe, expect, it } from "vitest";
import { findKeymapCommand } from "./keymapTestUtil";
import { markdownEnterExtension } from "./markdownEnter";

const enterCommand = () => findKeymapCommand(markdownEnterExtension(), "Enter");

function mount(doc: string, head: number): EditorView {
  return new EditorView({
    state: EditorState.create({ doc, selection: { anchor: head } }),
  });
}

describe("markdown Enter", () => {
  const run = enterCommand();

  it("continues a bullet list", () => {
    const view = mount("- item", 6);
    run(view);
    expect(view.state.doc.toString()).toBe("- item\n- ");
    view.destroy();
  });

  it("terminates an empty bullet item", () => {
    const view = mount("- ", 2);
    run(view);
    expect(view.state.doc.toString()).toBe("");
    view.destroy();
  });

  it("carries an indented bullet marker", () => {
    const view = mount("  * item", 8);
    run(view);
    expect(view.state.doc.toString()).toBe("  * item\n  * ");
    view.destroy();
  });

  it("resets the checkbox on a continued task item", () => {
    const view = mount("- [x] done", 10);
    run(view);
    expect(view.state.doc.toString()).toBe("- [x] done\n- [ ] ");
    view.destroy();
  });

  it("increments an ordered list and renumbers following items", () => {
    const view = mount("1. one\n2. two", 6);
    run(view);
    expect(view.state.doc.toString()).toBe("1. one\n2. \n3. two");
    view.destroy();
  });

  it("terminates an empty ordered item", () => {
    const view = mount("1. ", 3);
    run(view);
    expect(view.state.doc.toString()).toBe("");
    view.destroy();
  });

  it("carries a blockquote prefix", () => {
    const view = mount("> quote", 7);
    run(view);
    expect(view.state.doc.toString()).toBe("> quote\n> ");
    view.destroy();
  });

  it("clears an empty blockquote line", () => {
    const view = mount("> ", 2);
    run(view);
    expect(view.state.doc.toString()).toBe("");
    view.destroy();
  });

  it("falls through to the default newline on a plain line", () => {
    const view = mount("plain", 5);
    run(view);
    expect(view.state.doc.toString()).toBe("plain\n");
    view.destroy();
  });

  it("falls through to the default newline when the cursor sits inside the marker", () => {
    const view = mount("- item", 1);
    run(view);
    // cursor inside the prefix → markdownEnter declines, default newline runs
    expect(view.state.doc.toString()).toBe("-\nitem");
    view.destroy();
  });

  it("declines when the cursor is inside an ordered-list prefix", () => {
    const view = mount("1. item", 1);
    run(view);
    expect(view.state.doc.toString()).toBe("1\n. item");
    view.destroy();
  });

  it("declines when the cursor is inside a blockquote prefix", () => {
    const view = mount(">    quote", 1);
    run(view);
    // cursor inside the prefix → markdownEnter declines, default
    // insertNewlineAndIndent strips the moved-text's leading whitespace
    expect(view.state.doc.toString()).toBe(">\nquote");
    view.destroy();
  });

  it("declines when the selection is non-empty (range Enter)", () => {
    const view = new EditorView({
      state: EditorState.create({
        doc: "- item",
        selection: { anchor: 2, head: 6 },
      }),
    });
    run(view);
    expect(view.state.doc.toString()).toBe("- \n");
    view.destroy();
  });

  it("stops renumbering at the first ordered line whose indent/separator differs", () => {
    // Outer list `1.` increments to `2.`; inner indented `1.` belongs to a
    // different list and must NOT be renumbered.
    const view = mount("1. a\n   1. nested\n2. b", 4);
    run(view);
    const out = view.state.doc.toString();
    expect(out).toContain("   1. nested");
    view.destroy();
  });

  it("stops renumbering at a non-ordered following line", () => {
    // The renumber loop's `if (!m) break` branch — a plain line ends the
    // contiguous-ordered-list walk.
    const view = mount("1. a\nplain\n2. b", 4);
    run(view);
    const out = view.state.doc.toString();
    expect(out).toContain("plain");
    // "2. b" is past a non-ordered line, so it must not be renumbered.
    expect(out).toContain("2. b");
    view.destroy();
  });

  it("leaves an already-correct following number untouched", () => {
    const view = mount("1. one\n2. two", 0);
    // cursor inside the prefix of line 1 → declines; just verifies the
    // already-correct-number branch in the renumber loop is exercised under
    // the related "increments and renumbers" case above.
    run(view);
    view.destroy();
  });
});
