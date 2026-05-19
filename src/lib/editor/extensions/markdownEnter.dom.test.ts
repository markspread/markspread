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
});
