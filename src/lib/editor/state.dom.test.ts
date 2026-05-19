import "./extensions/jsdomLayoutShim";
// S-ED-001: tests for the EditorState/EditorView boot helpers.

import { EditorState as CMEditorState } from "@codemirror/state";
import { describe, expect, it } from "vitest";
import { DEFAULT_EDITOR_PREFS } from "./settings";
import { buildEditorState, mountEditor } from "./state";

describe("buildEditorState", () => {
  it("creates a state with the given document", () => {
    const state = buildEditorState("# Title\n\nbody");
    expect(state).toBeInstanceOf(CMEditorState);
    expect(state.doc.toString()).toBe("# Title\n\nbody");
  });

  it("allows multiple selections", () => {
    const state = buildEditorState("abc");
    expect(state.facet(CMEditorState.allowMultipleSelections)).toBe(true);
  });

  it("includes extra extensions", () => {
    const state = buildEditorState("x", [CMEditorState.changeFilter.of(() => true)]);
    // The extra extension is wired without throwing; the doc is intact.
    expect(state.doc.toString()).toBe("x");
  });

  it("respects an explicit prefs object", () => {
    const state = buildEditorState("x", [], { ...DEFAULT_EDITOR_PREFS, tabSize: 6 });
    expect(state.tabSize).toBe(6);
  });

  it("builds a plain-language state without markdown extensions", () => {
    const md = buildEditorState("text", [], DEFAULT_EDITOR_PREFS, "markdown");
    const plain = buildEditorState("text", [], DEFAULT_EDITOR_PREFS, "plain");
    expect(md.doc.toString()).toBe("text");
    expect(plain.doc.toString()).toBe("text");
  });

  it("caches core extensions across calls (no throw on repeated build)", () => {
    const a = buildEditorState("a");
    const b = buildEditorState("b");
    expect(a.doc.toString()).toBe("a");
    expect(b.doc.toString()).toBe("b");
  });
});

describe("mountEditor", () => {
  it("mounts an EditorView into a parent element", () => {
    const parent = document.createElement("div");
    document.body.appendChild(parent);
    const view = mountEditor(parent, "mounted doc");
    expect(view.state.doc.toString()).toBe("mounted doc");
    expect(parent.querySelector(".cm-editor")).not.toBeNull();
    view.destroy();
    parent.remove();
  });

  it("mounts a plain-language editor", () => {
    const parent = document.createElement("div");
    const view = mountEditor(parent, "plain", [], DEFAULT_EDITOR_PREFS, "plain");
    expect(view.state.doc.toString()).toBe("plain");
    view.destroy();
  });
});
