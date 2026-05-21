import "./jsdomLayoutShim";
// S-ED-058 / S-ED-059: large-file handling.

import { EditorState } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { describe, expect, it } from "vitest";
import {
  READ_ONLY_THRESHOLD_BYTES,
  largeFileExtension,
  setReadOnly,
  shouldOpenReadOnly,
} from "./largeFile";

describe("shouldOpenReadOnly", () => {
  it("returns true above the 50MB threshold", () => {
    expect(shouldOpenReadOnly(READ_ONLY_THRESHOLD_BYTES + 1)).toBe(true);
  });

  it("returns false at or below the threshold", () => {
    expect(shouldOpenReadOnly(READ_ONLY_THRESHOLD_BYTES)).toBe(false);
    expect(shouldOpenReadOnly(0)).toBe(false);
  });
});

function makeView(initialSize: number): EditorView {
  return new EditorView({
    state: EditorState.create({
      doc: "hello",
      extensions: [largeFileExtension(initialSize)],
    }),
  });
}

describe("largeFileExtension", () => {
  it("starts read-only when the document exceeds the threshold", () => {
    const view = makeView(READ_ONLY_THRESHOLD_BYTES + 1024);
    expect(view.state.facet(EditorView.editable)).toBe(false);
    view.destroy();
  });

  it("starts editable for normal-sized files", () => {
    const view = makeView(1024);
    expect(view.state.facet(EditorView.editable)).toBe(true);
    view.destroy();
  });
});

describe("setReadOnly", () => {
  it("flips the editor to read-only at runtime", () => {
    const view = makeView(0);
    setReadOnly(view, true);
    expect(view.state.facet(EditorView.editable)).toBe(false);
    setReadOnly(view, false);
    expect(view.state.facet(EditorView.editable)).toBe(true);
    view.destroy();
  });
});
