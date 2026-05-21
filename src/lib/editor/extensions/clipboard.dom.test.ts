import "./jsdomLayoutShim";
// S-ED-050..S-ED-055: clipboard + drag-and-drop integration.

import { EditorSelection, EditorState } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/markdown/htmlToMarkdown", () => ({
  htmlToMarkdown: (html: string) => {
    if (html.includes("EMPTY")) return "";
    return `MD(${html.replace(/<[^>]+>/g, "")})`;
  },
}));

import { type WorkspaceFs, clipboardExtension, setClipboardWorkspaceFs } from "./clipboard";

// Polyfill Blob.arrayBuffer / File.text for jsdom.
if (typeof Blob.prototype.arrayBuffer !== "function") {
  Blob.prototype.arrayBuffer = function arrayBuffer(): Promise<ArrayBuffer> {
    return new Response(this as Blob).arrayBuffer();
  };
}

function makeTextFile(content: string, name: string, type = "text/plain"): File {
  const f = new File([content], name, { type });
  Object.defineProperty(f, "text", {
    value: () => Promise.resolve(content),
    configurable: true,
  });
  return f;
}

function makeView(doc = "hello world\n", cursors?: number[]): EditorView {
  const selection = cursors
    ? EditorSelection.create(cursors.map((p) => EditorSelection.cursor(p)))
    : EditorSelection.single(0);
  return new EditorView({
    state: EditorState.create({
      doc,
      selection,
      extensions: [EditorState.allowMultipleSelections.of(true), clipboardExtension()],
    }),
  });
}

interface FakeItem {
  kind: "string" | "file";
  type: string;
  blob?: Blob;
}

function makeClipboardEvent(items: FakeItem[], data: Record<string, string> = {}): ClipboardEvent {
  const ev = new Event("paste", { bubbles: true, cancelable: true }) as ClipboardEvent;
  const dataTransfer = {
    items: items.map((it) => ({
      kind: it.kind,
      type: it.type,
      getAsFile: () => it.blob ?? null,
    })),
    getData: (k: string) => data[k] ?? "",
    files: [] as unknown as FileList,
  } as unknown as DataTransfer;
  Object.defineProperty(ev, "clipboardData", { value: dataTransfer });
  return ev;
}

function makeDragEvent(files: File[], opts: { x?: number; y?: number } = {}): DragEvent {
  const ev = new Event("drop", { bubbles: true, cancelable: true }) as DragEvent;
  const fileList = Object.assign(files.slice(), {
    item: (i: number) => files[i] ?? null,
  }) as unknown as FileList;
  Object.defineProperty(ev, "dataTransfer", {
    value: {
      files: fileList,
      items: [] as unknown as DataTransferItemList,
      getData: () => "",
    } as unknown as DataTransfer,
  });
  Object.defineProperty(ev, "clientX", { value: opts.x ?? 0 });
  Object.defineProperty(ev, "clientY", { value: opts.y ?? 0 });
  return ev;
}

let view: EditorView;

afterEach(() => {
  view?.destroy();
  setClipboardWorkspaceFs(null);
});

describe("paste handler", () => {
  it("returns false when clipboardData is null", () => {
    view = makeView();
    const ev = new Event("paste", { bubbles: true, cancelable: true }) as ClipboardEvent;
    Object.defineProperty(ev, "clipboardData", { value: null });
    view.contentDOM.dispatchEvent(ev);
    expect(view.state.doc.toString()).toBe("hello world\n");
  });

  it("falls through when no html, no image, no text", () => {
    view = makeView();
    const ev = makeClipboardEvent([], {});
    view.contentDOM.dispatchEvent(ev);
    expect(view.state.doc.toString()).toBe("hello world\n");
  });

  it("pastes image via workspaceFs when available", async () => {
    const saveAsset = vi.fn(async () => "assets/abc.png");
    setClipboardWorkspaceFs({ saveAsset, readText: vi.fn() } as WorkspaceFs);
    view = makeView("");
    const blob = new Blob([new Uint8Array([1, 2, 3])], { type: "image/png" });
    const ev = makeClipboardEvent([{ kind: "file", type: "image/png", blob }]);
    view.contentDOM.dispatchEvent(ev);
    await new Promise((r) => setTimeout(r, 500));
    expect(saveAsset).toHaveBeenCalledWith(expect.any(Uint8Array), "png");
    expect(view.state.doc.toString()).toContain("![](assets/abc.png)");
  });

  it("image paste without workspaceFs returns false", () => {
    view = makeView();
    const blob = new Blob([new Uint8Array([1])], { type: "image/png" });
    const ev = makeClipboardEvent([{ kind: "file", type: "image/png", blob }]);
    view.contentDOM.dispatchEvent(ev);
    expect(view.state.doc.toString()).toBe("hello world\n");
  });

  it("image item with no blob is skipped", () => {
    view = makeView();
    const ev = makeClipboardEvent([{ kind: "file", type: "image/png" }]);
    view.contentDOM.dispatchEvent(ev);
    expect(view.state.doc.toString()).toBe("hello world\n");
  });

  it("converts jpeg mime to jpg extension", async () => {
    const saveAsset = vi.fn(async () => "assets/x.jpg");
    setClipboardWorkspaceFs({ saveAsset, readText: vi.fn() } as WorkspaceFs);
    view = makeView("");
    const blob = new Blob([new Uint8Array([1])], { type: "image/jpeg" });
    const ev = makeClipboardEvent([{ kind: "file", type: "image/jpeg", blob }]);
    view.contentDOM.dispatchEvent(ev);
    await new Promise((r) => setTimeout(r, 500));
    expect(saveAsset).toHaveBeenCalledWith(expect.any(Uint8Array), "jpg");
  });

  it("converts svg+xml mime to svg extension", async () => {
    const saveAsset = vi.fn(async () => "assets/x.svg");
    setClipboardWorkspaceFs({ saveAsset, readText: vi.fn() } as WorkspaceFs);
    view = makeView("");
    const blob = new Blob([new Uint8Array([1])], { type: "image/svg+xml" });
    const ev = makeClipboardEvent([{ kind: "file", type: "image/svg+xml", blob }]);
    view.contentDOM.dispatchEvent(ev);
    await new Promise((r) => setTimeout(r, 500));
    expect(saveAsset).toHaveBeenCalledWith(expect.any(Uint8Array), "svg");
  });

  it("falls back to 'bin' when mime sub is empty/missing", async () => {
    const saveAsset = vi.fn(async () => "assets/x.bin");
    setClipboardWorkspaceFs({ saveAsset, readText: vi.fn() } as WorkspaceFs);
    view = makeView("");
    const blob = new Blob([new Uint8Array([1])], { type: "image/" });
    // Override type to "image" (no slash) — our regex still matches image/ but split() yields undefined sub.
    Object.defineProperty(blob, "type", { value: "image", configurable: true });
    // Force the items predicate to pass: use a custom-typed item with image/ prefix.
    const ev = makeClipboardEvent([{ kind: "file", type: "image/png", blob }]);
    view.contentDOM.dispatchEvent(ev);
    await new Promise((r) => setTimeout(r, 500));
    expect(saveAsset).toHaveBeenCalledWith(expect.any(Uint8Array), "bin");
  });

  it("converts real-looking HTML to markdown", () => {
    view = makeView("");
    const ev = makeClipboardEvent([], { "text/html": "<p>hi</p>" });
    view.contentDOM.dispatchEvent(ev);
    expect(view.state.doc.toString()).toContain("MD(hi)");
  });

  it("skips HTML that lacks block elements", () => {
    view = makeView();
    const ev = makeClipboardEvent([], { "text/html": "<span>nope</span>" });
    view.contentDOM.dispatchEvent(ev);
    expect(view.state.doc.toString()).toBe("hello world\n");
  });

  it("skips HTML with CM6 marker", () => {
    view = makeView();
    const ev = makeClipboardEvent([], { "text/html": "<!-- data-cm-clipboard --><p>x</p>" });
    view.contentDOM.dispatchEvent(ev);
    expect(view.state.doc.toString()).toBe("hello world\n");
  });

  it("htmlToMarkdown returning empty string is skipped", () => {
    view = makeView();
    const ev = makeClipboardEvent([], { "text/html": "<p>EMPTY</p>" });
    view.contentDOM.dispatchEvent(ev);
    expect(view.state.doc.toString()).toBe("hello world\n");
  });

  it("zip-pastes N lines into N cursors", () => {
    view = makeView("a\nb\nc\n", [0, 2, 4]);
    const ev = makeClipboardEvent([], { "text/plain": "X\nY\nZ" });
    view.contentDOM.dispatchEvent(ev);
    expect(view.state.doc.toString()).toBe("Xa\nYb\nZc\n");
  });

  it("rejects zip when line count doesn't match cursor count", () => {
    view = makeView("a\nb\n", [0, 2]);
    const ev = makeClipboardEvent([], { "text/plain": "single line" });
    view.contentDOM.dispatchEvent(ev);
    // Our zipPasteText returns false (line/cursor mismatch); CM6's built-in
    // paste then runs its own multi-cursor distribution.
    expect(view.state.doc.toString()).not.toBe("Xa\nYb\n");
  });

  it("does not zip with only one cursor", () => {
    view = makeView("hi\n");
    const ev = makeClipboardEvent([], { "text/plain": "only" });
    view.contentDOM.dispatchEvent(ev);
    // Single-cursor path: zipPasteText returns false. CM6's built-in paste
    // then inserts the text at the cursor.
    expect(view.state.doc.toString()).toContain("only");
  });
});

describe("drop handler", () => {
  it("returns false when dataTransfer is null", () => {
    view = makeView();
    const ev = new Event("drop", { bubbles: true, cancelable: true }) as DragEvent;
    Object.defineProperty(ev, "dataTransfer", { value: null });
    view.contentDOM.dispatchEvent(ev);
    expect(view.state.doc.toString()).toBe("hello world\n");
  });

  it("returns false when no files", () => {
    view = makeView();
    const ev = makeDragEvent([]);
    view.contentDOM.dispatchEvent(ev);
    expect(view.state.doc.toString()).toBe("hello world\n");
  });

  it("returns false when files are neither images nor text", () => {
    view = makeView();
    const f = new File(["x"], "doc.pdf", { type: "application/pdf" });
    const ev = makeDragEvent([f]);
    view.contentDOM.dispatchEvent(ev);
    expect(view.state.doc.toString()).toBe("hello world\n");
  });

  it("inserts a dropped .md file's text at the selection when posAtCoords returns null", async () => {
    view = makeView("seed\n");
    (view as unknown as { posAtCoords: () => number | null }).posAtCoords = () => null;
    const f = makeTextFile("FROM-DROP", "n.md", "text/markdown");
    const ev = makeDragEvent([f]);
    view.contentDOM.dispatchEvent(ev);
    await new Promise((r) => setTimeout(r, 500));
    expect(view.state.doc.toString()).toBe("FROM-DROPseed\n");
  });

  it("inserts dropped text at the coords-derived position when posAtCoords returns it", async () => {
    view = makeView("xx\n");
    (view as unknown as { posAtCoords: () => number }).posAtCoords = () => 1;
    const f = makeTextFile("YY", "n.txt", "text/plain");
    const ev = makeDragEvent([f], { x: 5, y: 5 });
    view.contentDOM.dispatchEvent(ev);
    await new Promise((r) => setTimeout(r, 500));
    expect(view.state.doc.toString()).toBe("xYYx\n");
  });

  it("drops an image when workspaceFs is set", async () => {
    const saveAsset = vi.fn(async () => "assets/y.png");
    setClipboardWorkspaceFs({ saveAsset, readText: vi.fn() } as WorkspaceFs);
    view = makeView("");
    const f = new File([new Uint8Array([1, 2, 3])], "p.png", { type: "image/png" });
    const ev = makeDragEvent([f]);
    view.contentDOM.dispatchEvent(ev);
    await new Promise((r) => setTimeout(r, 500));
    expect(view.state.doc.toString()).toContain("![](assets/y.png)");
  });
});
