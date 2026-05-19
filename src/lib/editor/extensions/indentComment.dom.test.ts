import "./jsdomLayoutShim";
// S-ED-041/043/044/045: tests for indent, comment, and goto-line wiring.

import { markdown } from "@codemirror/lang-markdown";
import { EditorState } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { describe, expect, it } from "vitest";
import { commentExtension } from "./comment";
import { gotoLineExtension } from "./gotoLine";
import { indentExtension } from "./indent";
import { findKeymapCommand } from "./keymapTestUtil";

const commandFor = findKeymapCommand;

describe("indent extension", () => {
  it("outdents an indented line with Shift-Tab", () => {
    const view = new EditorView({
      state: EditorState.create({
        doc: "    indented",
        selection: { anchor: 6 },
        extensions: indentExtension(),
      }),
    });
    commandFor(indentExtension(), "Shift-Tab")(view);
    expect(view.state.doc.toString().startsWith("  indented")).toBe(true);
    view.destroy();
  });
});

describe("comment extension", () => {
  it("toggles an HTML block comment around the selection in markdown", () => {
    const view = new EditorView({
      state: EditorState.create({
        doc: "secret",
        selection: { anchor: 0, head: 6 },
        extensions: [markdown(), commentExtension()],
      }),
    });
    commandFor(commentExtension(), "Mod-Alt-/")(view);
    expect(view.state.doc.toString()).toContain("<!--");
    expect(view.state.doc.toString()).toContain("-->");
    view.destroy();
  });

  it("Mod-/ toggleComment runs without throwing in markdown", () => {
    const view = new EditorView({
      state: EditorState.create({
        doc: "line",
        selection: { anchor: 0 },
        extensions: [markdown(), commentExtension()],
      }),
    });
    expect(() => commandFor(commentExtension(), "Mod-/")(view)).not.toThrow();
    view.destroy();
  });
});

describe("gotoLine extension", () => {
  it("opens the goto-line panel on Mod-g", () => {
    const view = new EditorView({
      state: EditorState.create({
        doc: "a\nb\nc",
        extensions: gotoLineExtension(),
      }),
    });
    expect(commandFor(gotoLineExtension(), "Mod-g")(view)).toBe(true);
    view.destroy();
  });

  it("Ctrl-g is registered as an alias", () => {
    const view = new EditorView({
      state: EditorState.create({ doc: "x", extensions: gotoLineExtension() }),
    });
    expect(commandFor(gotoLineExtension(), "Ctrl-g")(view)).toBe(true);
    view.destroy();
  });
});
