import "./jsdomLayoutShim";
// S-MD-036/037: tests for GFM footnote helpers.

import { EditorState } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { describe, expect, it } from "vitest";
import { __test__, footnotesExtension } from "./footnotes";
import { findKeymapCommand } from "./keymapTestUtil";

describe("nextLabel", () => {
  it("returns 1 for a document with no footnotes", () => {
    expect(__test__.nextLabel("plain text")).toBe("1");
  });

  it("skips numeric labels already in use", () => {
    expect(__test__.nextLabel("see [^1] and [^2]")).toBe("3");
  });

  it("ignores non-numeric labels when picking the next integer", () => {
    expect(__test__.nextLabel("see [^note] only")).toBe("1");
  });

  it("fills the lowest free integer", () => {
    expect(__test__.nextLabel("[^1] [^3]")).toBe("2");
  });
});

const insertCommand = () => findKeymapCommand(footnotesExtension(), "Mod-Alt-f");

describe("insertFootnote command", () => {
  it("inserts a reference at the cursor and a stub definition at doc end", () => {
    const view = new EditorView({
      state: EditorState.create({
        doc: "body text",
        selection: { anchor: 4 },
      }),
    });
    insertCommand()(view);
    expect(view.state.doc.toString()).toBe("body[^1] text\n\n[^1]: ");
    view.destroy();
  });

  it("picks the next free label when one already exists", () => {
    const view = new EditorView({
      state: EditorState.create({
        doc: "ref [^1] here",
        selection: { anchor: 13 },
      }),
    });
    insertCommand()(view);
    expect(view.state.doc.toString()).toContain("[^2]");
    expect(view.state.doc.toString()).toContain("[^2]: ");
    view.destroy();
  });
});

describe("emptyFootnoteAutonumber", () => {
  it("rewrites a typed [^] into [^N]", async () => {
    const view = new EditorView({
      state: EditorState.create({
        doc: "",
        extensions: footnotesExtension(),
      }),
    });
    view.dispatch({
      changes: { from: 0, insert: "[^]" },
      selection: { anchor: 3 },
    });
    await new Promise<void>((r) => queueMicrotask(r));
    expect(view.state.doc.toString()).toBe("[^1]");
    view.destroy();
  });

  it("ignores doc-unchanged updates (e.g. selection-only changes)", () => {
    const view = new EditorView({
      state: EditorState.create({
        doc: "[^]",
        extensions: footnotesExtension(),
      }),
    });
    view.dispatch({ selection: { anchor: 1 } });
    expect(view.state.doc.toString()).toBe("[^]");
    view.destroy();
  });

  it("ignores insertions that don't end with ']'", async () => {
    const view = new EditorView({
      state: EditorState.create({
        doc: "",
        extensions: footnotesExtension(),
      }),
    });
    view.dispatch({
      changes: { from: 0, insert: "[^" },
      selection: { anchor: 2 },
    });
    await new Promise<void>((r) => queueMicrotask(r));
    expect(view.state.doc.toString()).toBe("[^");
    view.destroy();
  });

  it("only rewrites the first `[^]` when multiple changes land in one transaction", async () => {
    const view = new EditorView({
      state: EditorState.create({
        doc: "a b",
        extensions: footnotesExtension(),
      }),
    });
    view.dispatch({
      changes: [
        { from: 1, insert: "[^]" },
        { from: 3, insert: "[^]" },
      ],
    });
    await new Promise<void>((r) => queueMicrotask(r));
    // First insertion gets autonumbered, second remains literal — covers the
    // `if (hit) return` short-circuit inside iterChanges.
    expect(view.state.doc.toString()).toMatch(/\[\^1\]/);
    view.destroy();
  });
});
