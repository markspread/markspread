import { cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

// CodeMirror needs a real layout engine; mock the editor state seam so the
// component's container + lifecycle wiring is what we exercise.
interface FakeView {
  destroy: () => void;
  scrollDOM: HTMLElement;
  state: { doc: { toString: () => string; lines: number } };
}

const mountEditor = vi.fn((host: HTMLElement, doc: string): FakeView => {
  const scrollDOM = document.createElement("div");
  host.appendChild(scrollDOM);
  return {
    destroy: () => {},
    scrollDOM,
    state: { doc: { toString: () => doc, lines: 1 } },
  };
});

vi.mock("@/lib/editor/state", () => ({
  mountEditor: (host: HTMLElement, doc: string) => mountEditor(host, doc),
  buildEditorState: vi.fn(),
}));
vi.mock("@codemirror/view", () => ({
  EditorView: {
    updateListener: { of: () => ({}) },
  },
  placeholder: () => ({}),
}));
vi.mock("@codemirror/state", () => ({
  EditorSelection: { cursor: () => ({}) },
}));

import { Editor } from "./Editor";

afterEach(cleanup);

describe("Editor", () => {
  it("mounts a CodeMirror container", () => {
    const { container } = render(<Editor initialDoc="hello" />);
    expect(container.querySelector("div")).not.toBeNull();
    expect(mountEditor).toHaveBeenCalled();
  });

  it("applies a custom className", () => {
    const { container } = render(<Editor initialDoc="x" className="custom-cls" />);
    expect(container.querySelector(".custom-cls")).not.toBeNull();
  });

  it("destroys the view on unmount without throwing", () => {
    const { unmount } = render(<Editor initialDoc="x" tabId="t1" />);
    expect(() => unmount()).not.toThrow();
  });
});
