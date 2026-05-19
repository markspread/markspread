import "./jsdomLayoutShim";
// S-ED-003..010: tests for the search extension's "replace all in
// selection" custom command.

import { SearchQuery, setSearchQuery } from "@codemirror/search";
import { EditorState, type EditorStateConfig } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { describe, expect, it } from "vitest";
import { findKeymapCommand } from "./keymapTestUtil";
import { searchExtension } from "./search";

const replaceAllInSelectionCommand = () =>
  findKeymapCommand(searchExtension(), "Mod-Alt-Shift-Enter");

function mount(doc: string, selection: NonNullable<EditorStateConfig["selection"]>): EditorView {
  return new EditorView({
    state: EditorState.create({ doc, selection, extensions: searchExtension() }),
  });
}

describe("replaceAllInSelection", () => {
  const run = replaceAllInSelectionCommand();

  it("returns false when the search query is empty", () => {
    const view = mount("hello hello", { anchor: 0, head: 11 });
    view.dispatch({
      effects: setSearchQuery.of(new SearchQuery({ search: "", replace: "x" })),
    });
    expect(run(view)).toBe(false);
    view.destroy();
  });

  it("returns false when the selection is empty", () => {
    const view = mount("hello hello", { anchor: 0 });
    view.dispatch({
      effects: setSearchQuery.of(new SearchQuery({ search: "hello", replace: "X" })),
    });
    expect(run(view)).toBe(false);
    view.destroy();
  });

  it("replaces all literal matches inside the selection only", () => {
    const view = mount("ab ab\nab ab", { anchor: 0, head: 5 });
    view.dispatch({
      effects: setSearchQuery.of(new SearchQuery({ search: "ab", replace: "X" })),
    });
    expect(run(view)).toBe(true);
    expect(view.state.doc.toString()).toBe("X X\nab ab");
    view.destroy();
  });

  it("honours case-insensitive literal matching", () => {
    const view = mount("Ab aB ab", { anchor: 0, head: 8 });
    view.dispatch({
      effects: setSearchQuery.of(
        new SearchQuery({ search: "ab", replace: "Z", caseSensitive: false }),
      ),
    });
    run(view);
    expect(view.state.doc.toString()).toBe("Z Z Z");
    view.destroy();
  });

  it("supports regexp replacement within the selection", () => {
    const view = mount("a1 a2 a3", { anchor: 0, head: 8 });
    view.dispatch({
      effects: setSearchQuery.of(new SearchQuery({ search: "a\\d", replace: "N", regexp: true })),
    });
    run(view);
    expect(view.state.doc.toString()).toBe("N N N");
    view.destroy();
  });

  it("returns true (no-op) when the query matches nothing in the selection", () => {
    const view = mount("hello world", { anchor: 0, head: 5 });
    view.dispatch({
      effects: setSearchQuery.of(new SearchQuery({ search: "zzz", replace: "Q" })),
    });
    expect(run(view)).toBe(true);
    expect(view.state.doc.toString()).toBe("hello world");
    view.destroy();
  });
});
