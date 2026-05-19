import "./jsdomLayoutShim";
// S-ED-034..038: tests for line-level editing commands.

import { EditorState, type EditorStateConfig } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { describe, expect, it } from "vitest";
import { findKeymapCommand } from "./keymapTestUtil";
import { lineCommandsExtension } from "./lineCommands";

const commandFor = (key: string) => findKeymapCommand(lineCommandsExtension(), key);

function mount(doc: string, selection: NonNullable<EditorStateConfig["selection"]>): EditorView {
  return new EditorView({ state: EditorState.create({ doc, selection }) });
}

describe("line commands", () => {
  it("moves a line down with Alt-ArrowDown", () => {
    const view = mount("a\nb\nc", { anchor: 0 });
    commandFor("Alt-ArrowDown")(view);
    expect(view.state.doc.toString()).toBe("b\na\nc");
    view.destroy();
  });

  it("moves a line up with Alt-ArrowUp", () => {
    const view = mount("a\nb\nc", { anchor: 2 });
    commandFor("Alt-ArrowUp")(view);
    expect(view.state.doc.toString()).toBe("b\na\nc");
    view.destroy();
  });

  it("duplicates a line down with Mod-Shift-d", () => {
    const view = mount("dup", { anchor: 0 });
    commandFor("Mod-Shift-d")(view);
    expect(view.state.doc.toString()).toBe("dup\ndup");
    view.destroy();
  });

  it("copies a line up with Alt-Shift-ArrowUp", () => {
    const view = mount("dup", { anchor: 0 });
    commandFor("Alt-Shift-ArrowUp")(view);
    expect(view.state.doc.toString()).toBe("dup\ndup");
    view.destroy();
  });

  it("deletes a line with Mod-Shift-k", () => {
    const view = mount("a\nb\nc", { anchor: 2 });
    commandFor("Mod-Shift-k")(view);
    expect(view.state.doc.toString()).toBe("a\nc");
    view.destroy();
  });

  it("selects the current line with Mod-l", () => {
    const view = mount("hello", { anchor: 2 });
    commandFor("Mod-l")(view);
    expect(view.state.selection.main.from).toBe(0);
    expect(view.state.selection.main.to).toBe(5);
    view.destroy();
  });

  it("deletes to line end with Mod-Delete", () => {
    const view = mount("hello world", { anchor: 5 });
    commandFor("Mod-Delete")(view);
    expect(view.state.doc.toString()).toBe("hello");
    view.destroy();
  });
});
