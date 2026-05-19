import "./jsdomLayoutShim";
// S-MD-002..006: tests for markdown formatting commands.

import { EditorState, type EditorStateConfig } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { describe, expect, it } from "vitest";
import { findKeymapCommand } from "./keymapTestUtil";
import { markdownFormatExtension } from "./markdownFormat";

const commandFor = (key: string) => findKeymapCommand(markdownFormatExtension(), key);

function mount(doc: string, selection?: NonNullable<EditorStateConfig["selection"]>): EditorView {
  return new EditorView({
    state: EditorState.create(selection ? { doc, selection } : { doc }),
  });
}

describe("markdown inline format", () => {
  it("wraps a non-empty selection in bold", () => {
    const view = mount("word", { anchor: 0, head: 4 });
    commandFor("Mod-b")(view);
    expect(view.state.doc.toString()).toBe("**word**");
    expect(view.state.selection.main.from).toBe(2);
    view.destroy();
  });

  it("unwraps an already-wrapped selection", () => {
    const view = mount("**word**", { anchor: 2, head: 6 });
    commandFor("Mod-b")(view);
    expect(view.state.doc.toString()).toBe("word");
    view.destroy();
  });

  it("strips markers when the selection includes them", () => {
    const view = mount("**word**", { anchor: 0, head: 8 });
    commandFor("Mod-b")(view);
    expect(view.state.doc.toString()).toBe("word");
    view.destroy();
  });

  it("inserts an empty pair with the cursor in the middle", () => {
    const view = mount("", { anchor: 0 });
    commandFor("Mod-i")(view);
    expect(view.state.doc.toString()).toBe("**");
    expect(view.state.selection.main.head).toBe(1);
    view.destroy();
  });

  it("toggles inline code and strikethrough", () => {
    const code = mount("x", { anchor: 0, head: 1 });
    commandFor("Mod-e")(code);
    expect(code.state.doc.toString()).toBe("`x`");
    code.destroy();
    const strike = mount("x", { anchor: 0, head: 1 });
    commandFor("Mod-Shift-x")(strike);
    expect(strike.state.doc.toString()).toBe("~~x~~");
    strike.destroy();
  });
});

describe("markdown heading toggle", () => {
  it("adds a heading prefix to a plain line", () => {
    const view = mount("Title", { anchor: 0 });
    commandFor("Mod-1")(view);
    expect(view.state.doc.toString()).toBe("# Title");
    view.destroy();
  });

  it("removes a heading when toggling the same level", () => {
    const view = mount("# Title", { anchor: 2 });
    commandFor("Mod-1")(view);
    expect(view.state.doc.toString()).toBe("Title");
    view.destroy();
  });

  it("changes the level when toggling a different level", () => {
    const view = mount("# Title", { anchor: 2 });
    commandFor("Mod-3")(view);
    expect(view.state.doc.toString()).toBe("### Title");
    view.destroy();
  });

  it("applies a heading to every line spanned by the selection", () => {
    const view = mount("a\nb", { anchor: 0, head: 3 });
    commandFor("Mod-2")(view);
    expect(view.state.doc.toString()).toBe("## a\n## b");
    view.destroy();
  });
});
