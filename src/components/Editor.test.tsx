import { act, cleanup, render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Capture the updateListener callback and the latest mounted view so the
// tests can drive its lifecycle directly. CodeMirror has no usable jsdom
// support, so the seam is the `@/lib/editor/state` module.
let lastUpdateListener: ((u: UpdateLike) => void) | null = null;
interface UpdateLike {
  docChanged: boolean;
  selectionSet: boolean;
  state: {
    doc: {
      toString: () => string;
      lineAt: (head: number) => { number: number; from: number };
    };
    selection: { main: { head: number } };
  };
}

interface FakeView {
  destroy: ReturnType<typeof vi.fn>;
  dispatch: ReturnType<typeof vi.fn>;
  setState: ReturnType<typeof vi.fn>;
  scrollDOM: HTMLElement;
  state: {
    doc: {
      toString: () => string;
      lines: number;
      line: (n: number) => { from: number; length: number };
      lineAt: (head: number) => { number: number; from: number };
    };
    selection: { main: { head: number } };
  };
}

let docStore = "";
let lastView: FakeView | null = null;
const mountEditor = vi.fn((host: HTMLElement, doc: string): FakeView => {
  docStore = doc;
  const scrollDOM = document.createElement("div");
  Object.defineProperty(scrollDOM, "scrollTop", {
    value: 0,
    writable: true,
    configurable: true,
  });
  host.appendChild(scrollDOM);
  const view: FakeView = {
    destroy: vi.fn(),
    dispatch: vi.fn(({ changes }: { changes?: { insert?: string } } = {}) => {
      if (changes?.insert !== undefined) docStore = changes.insert;
    }),
    setState: vi.fn(),
    scrollDOM,
    state: {
      doc: {
        toString: () => docStore,
        lines: 5,
        line: (n: number) => ({ from: (n - 1) * 10, length: 8 }),
        lineAt: (head: number) => ({ number: 2, from: head - 3 }),
      },
      selection: { main: { head: 12 } },
    },
  };
  lastView = view;
  return view;
});

vi.mock("@/lib/editor/state", () => ({
  mountEditor: (host: HTMLElement, doc: string) => mountEditor(host, doc),
  buildEditorState: vi.fn((_doc: string) => ({ kind: "fake-state" })),
}));
vi.mock("@codemirror/view", () => ({
  EditorView: {
    updateListener: {
      of: (fn: (u: UpdateLike) => void) => {
        lastUpdateListener = fn;
        return { kind: "updateListener" };
      },
    },
  },
  placeholder: (_text: string) => ({ kind: "placeholder" }),
}));
vi.mock("@codemirror/state", () => ({
  EditorSelection: { cursor: (pos: number) => ({ kind: "cursor", pos }) },
}));

import { Editor } from "./Editor";

beforeEach(() => {
  lastUpdateListener = null;
  lastView = null;
  docStore = "";
  mountEditor.mockClear();
});

afterEach(cleanup);

function makeUpdate(opts: {
  docChanged?: boolean;
  selectionSet?: boolean;
  doc?: string;
  head?: number;
}): UpdateLike {
  return {
    docChanged: !!opts.docChanged,
    selectionSet: !!opts.selectionSet,
    state: {
      doc: {
        toString: () => opts.doc ?? "",
        lineAt: (head: number) => ({ number: 3, from: head - 2 }),
      },
      selection: { main: { head: opts.head ?? 0 } },
    },
  };
}

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
    expect(lastView?.destroy).toHaveBeenCalled();
  });

  it("emits onChange when the updateListener sees a doc change", () => {
    const onChange = vi.fn();
    render(<Editor initialDoc="" onChange={onChange} />);
    expect(lastUpdateListener).not.toBeNull();
    act(() => lastUpdateListener?.(makeUpdate({ docChanged: true, doc: "next" })));
    expect(onChange).toHaveBeenCalledWith("next");
  });

  it("emits onPositionChange when selection moves", () => {
    const onPositionChange = vi.fn();
    render(<Editor initialDoc="" onPositionChange={onPositionChange} />);
    act(() => lastUpdateListener?.(makeUpdate({ selectionSet: true, head: 7 })));
    expect(onPositionChange).toHaveBeenCalledWith(
      expect.objectContaining({ line: 2, column: expect.any(Number) }),
    );
  });

  it("emits onSelectionRange for a non-empty selection", () => {
    const onSelectionRange = vi.fn();
    render(<Editor initialDoc="" onSelectionRange={onSelectionRange} />);
    act(() =>
      lastUpdateListener?.({
        docChanged: false,
        selectionSet: true,
        state: {
          doc: {
            toString: () => "hello world",
            lineAt: (head: number) => ({ number: 1, from: head }),
          },
          selection: { main: { head: 5, from: 0, to: 5 } } as never,
        },
      }),
    );
    expect(onSelectionRange).toHaveBeenCalledWith({
      fromOffset: 0,
      toOffset: 5,
      fullText: "hello world",
    });
  });

  it("skips onSelectionRange when the selection is empty (caret only)", () => {
    const onSelectionRange = vi.fn();
    render(<Editor initialDoc="" onSelectionRange={onSelectionRange} />);
    act(() =>
      lastUpdateListener?.({
        docChanged: false,
        selectionSet: true,
        state: {
          doc: {
            toString: () => "hello",
            lineAt: (head: number) => ({ number: 1, from: head }),
          },
          selection: { main: { head: 3, from: 3, to: 3 } } as never,
        },
      }),
    );
    expect(onSelectionRange).not.toHaveBeenCalled();
  });

  it("skips onChange callbacks when no listener was registered", () => {
    render(<Editor initialDoc="" />);
    expect(() => lastUpdateListener?.(makeUpdate({ docChanged: true, doc: "x" }))).not.toThrow();
  });

  it("restores the cursor and scroll from initialPosition", () => {
    render(
      <Editor
        initialDoc="abcdefghij\nklmnop\nqrstuv"
        initialPosition={{ line: 1, column: 2, scrollTop: 84 }}
      />,
    );
    expect(lastView?.dispatch).toHaveBeenCalledWith(
      expect.objectContaining({ selection: expect.any(Object) }),
    );
    expect(lastView?.scrollDOM.scrollTop).toBe(84);
  });

  it("clamps a restore line above the document length", () => {
    render(<Editor initialDoc="x" initialPosition={{ line: 99, column: 0, scrollTop: 0 }} />);
    expect(lastView?.dispatch).toHaveBeenCalled();
  });

  it("clamps a negative restore line up to the first line", () => {
    render(<Editor initialDoc="x" initialPosition={{ line: -3, column: 0, scrollTop: 0 }} />);
    expect(lastView?.dispatch).toHaveBeenCalled();
  });

  it("fires onPositionChange when scrollDOM scrolls", () => {
    const onPositionChange = vi.fn();
    render(<Editor initialDoc="x" onPositionChange={onPositionChange} />);
    onPositionChange.mockClear();
    Object.defineProperty(lastView?.scrollDOM, "scrollTop", {
      value: 200,
      writable: true,
      configurable: true,
    });
    lastView?.scrollDOM.dispatchEvent(new Event("scroll"));
    expect(onPositionChange).toHaveBeenCalledWith(expect.objectContaining({ scrollTop: 200 }));
  });

  it("ignores scroll events when no onPositionChange is registered", () => {
    render(<Editor initialDoc="x" />);
    expect(() => lastView?.scrollDOM.dispatchEvent(new Event("scroll"))).not.toThrow();
  });

  it("reconfigures via setState when extensions change", () => {
    const { rerender } = render(<Editor initialDoc="x" extensions={[]} />);
    lastView?.setState.mockClear();
    rerender(<Editor initialDoc="x" extensions={[{ kind: "ext2" } as never]} />);
    expect(lastView?.setState).toHaveBeenCalled();
  });

  it("does not reconfigure when extensions becomes undefined", () => {
    const { rerender } = render(<Editor initialDoc="x" extensions={[]} />);
    lastView?.setState.mockClear();
    rerender(<Editor initialDoc="x" />);
    expect(lastView?.setState).not.toHaveBeenCalled();
  });

  it("reconciles when remoteDoc differs from the current doc", () => {
    docStore = "local";
    const { rerender } = render(<Editor initialDoc="local" remoteDoc="local" />);
    expect(lastView?.dispatch).not.toHaveBeenCalled();
    rerender(<Editor initialDoc="local" remoteDoc="remote update" />);
    expect(lastView?.dispatch).toHaveBeenCalledWith(
      expect.objectContaining({
        changes: expect.objectContaining({ insert: "remote update" }),
      }),
    );
  });

  it("skips remoteDoc reconcile when value matches the current doc", () => {
    docStore = "same";
    const { rerender } = render(<Editor initialDoc="same" remoteDoc="same" />);
    lastView?.dispatch.mockClear();
    rerender(<Editor initialDoc="same" remoteDoc="same" />);
    expect(lastView?.dispatch).not.toHaveBeenCalled();
  });

  it("skips remoteDoc reconcile when remoteDoc is undefined", () => {
    const { rerender } = render(<Editor initialDoc="x" />);
    lastView?.dispatch.mockClear();
    rerender(<Editor initialDoc="x" />);
    expect(lastView?.dispatch).not.toHaveBeenCalled();
  });
});
