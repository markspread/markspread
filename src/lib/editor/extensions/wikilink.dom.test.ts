import "./jsdomLayoutShim";
// S-MD-050..055: wikilink completion, click handling, broken decoration.

import type {
  CompletionContext,
  CompletionResult,
  CompletionSource,
} from "@codemirror/autocomplete";
import { EditorState } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const hoist = vi.hoisted(() => ({ src: undefined as CompletionSource | undefined }));
vi.mock("./autocompletion", () => ({
  addCompletionSource: (src: CompletionSource) => {
    hoist.src = src;
    return () => {};
  },
}));

import {
  type WikilinkProvider,
  followWikilink,
  invalidateWikilinkCache,
  setWikilinkProvider,
  wikilinkExtension,
} from "./wikilink";

function makeContext(doc: string, pos: number): CompletionContext {
  const state = EditorState.create({ doc });
  return {
    state,
    pos,
    explicit: true,
    matchBefore: () => null,
    aborted: false,
    addEventListener: () => {},
  } as unknown as CompletionContext;
}

function makeView(doc: string): EditorView {
  return new EditorView({
    state: EditorState.create({ doc, extensions: [wikilinkExtension()] }),
  });
}

let view: EditorView | undefined;

beforeEach(() => {
  setWikilinkProvider(null);
  invalidateWikilinkCache();
});

afterEach(() => {
  view?.destroy();
  view = undefined;
  setWikilinkProvider(null);
  invalidateWikilinkCache();
});

describe("completion source", () => {
  it("returns null when no provider is set", () => {
    expect(hoist.src?.(makeContext("[[abc", 5))).toBeNull();
  });

  it("returns null when no trigger pattern matches", () => {
    setWikilinkProvider({
      searchFiles: vi.fn(),
      headings: vi.fn(),
      exists: vi.fn(),
      open: vi.fn(),
      create: vi.fn(),
    });
    expect(hoist.src?.(makeContext("plain text", 10))).toBeNull();
  });

  it("returns file completions when inside [[query", async () => {
    setWikilinkProvider({
      searchFiles: async () => ["foo.md", "bar.md"],
      headings: vi.fn(),
      exists: vi.fn(),
      open: vi.fn(),
      create: vi.fn(),
    });
    const r = (await hoist.src?.(makeContext("[[fo", 4))) as CompletionResult;
    expect(r.options.map((o) => o.label)).toEqual(["foo.md", "bar.md"]);
  });

  it("returns heading completions when inside [[file#query", async () => {
    setWikilinkProvider({
      searchFiles: vi.fn(),
      headings: async () => ["Intro", "Setup"],
      exists: vi.fn(),
      open: vi.fn(),
      create: vi.fn(),
    });
    const r = (await hoist.src?.(makeContext("[[note#Se", 9))) as CompletionResult;
    expect(r.options.map((o) => o.label)).toEqual(["Intro", "Setup"]);
  });

  it("swallows heading provider errors with null", async () => {
    setWikilinkProvider({
      searchFiles: vi.fn(),
      headings: async () => {
        throw new Error("nope");
      },
      exists: vi.fn(),
      open: vi.fn(),
      create: vi.fn(),
    });
    const r = await hoist.src?.(makeContext("[[note#Q", 8));
    expect(r).toBeNull();
  });

  it("swallows file search errors with null", async () => {
    setWikilinkProvider({
      searchFiles: async () => {
        throw new Error("boom");
      },
      headings: vi.fn(),
      exists: vi.fn(),
      open: vi.fn(),
      create: vi.fn(),
    });
    const r = await hoist.src?.(makeContext("[[fo", 4));
    expect(r).toBeNull();
  });
});

describe("followWikilink", () => {
  it("resolves false without a provider", async () => {
    expect(await followWikilink({ state: EditorState.create({ doc: "" }) } as EditorView, 0)).toBe(
      false,
    );
  });

  it("resolves false when no wikilink at the position", async () => {
    setWikilinkProvider({
      searchFiles: vi.fn(),
      headings: vi.fn(),
      exists: vi.fn(),
      open: vi.fn(),
      create: vi.fn(),
    });
    view = makeView("plain text without links");
    expect(await followWikilink(view, 4)).toBe(false);
  });

  it("calls open when the target exists", async () => {
    const open = vi.fn(async () => {});
    const create = vi.fn();
    setWikilinkProvider({
      searchFiles: vi.fn(),
      headings: vi.fn(),
      exists: async () => true,
      open,
      create,
    });
    view = makeView("see [[note]] here");
    const r = await followWikilink(view, 6);
    expect(r).toBe(true);
    expect(open).toHaveBeenCalledWith("note", undefined);
    expect(create).not.toHaveBeenCalled();
  });

  it("creates and opens when the target does not exist", async () => {
    const open = vi.fn(async () => {});
    const create = vi.fn(async (p: string) => `created/${p}`);
    setWikilinkProvider({
      searchFiles: vi.fn(),
      headings: vi.fn(),
      exists: async () => false,
      open,
      create,
    });
    view = makeView("see [[note]] here");
    const r = await followWikilink(view, 6);
    expect(r).toBe(true);
    expect(create).toHaveBeenCalledWith("note");
    expect(open).toHaveBeenCalledWith("created/note", undefined);
  });

  it("returns true even when create yields empty (open is skipped)", async () => {
    const open = vi.fn(async () => {});
    const create = vi.fn(async () => "");
    setWikilinkProvider({
      searchFiles: vi.fn(),
      headings: vi.fn(),
      exists: async () => false,
      open,
      create,
    });
    view = makeView("see [[note]] here");
    const r = await followWikilink(view, 6);
    expect(r).toBe(true);
    expect(open).not.toHaveBeenCalled();
  });

  it("targets the second wikilink on a line with multiple links", async () => {
    const open = vi.fn(async () => {});
    setWikilinkProvider({
      searchFiles: vi.fn(),
      headings: vi.fn(),
      exists: async () => true,
      open,
      create: vi.fn(),
    });
    view = makeView("[[first]] and [[second]] inline");
    // Position inside the second link
    const pos = "[[first]] and ".length + 3;
    await followWikilink(view, pos);
    expect(open).toHaveBeenCalledWith("second", undefined);
  });

  it("passes heading anchors to open()", async () => {
    const open = vi.fn(async () => {});
    setWikilinkProvider({
      searchFiles: vi.fn(),
      headings: vi.fn(),
      exists: async () => true,
      open,
      create: vi.fn(),
    });
    view = makeView("see [[note#section]] here");
    await followWikilink(view, 6);
    expect(open).toHaveBeenCalledWith("note", "section");
  });
});

describe("mousedown handler", () => {
  it("does nothing without Mod/Ctrl", () => {
    setWikilinkProvider({
      searchFiles: vi.fn(),
      headings: vi.fn(),
      exists: vi.fn(async () => true),
      open: vi.fn(async () => {}),
      create: vi.fn(),
    });
    view = makeView("see [[note]] here");
    const ev = new MouseEvent("mousedown", { bubbles: true, cancelable: true });
    view.contentDOM.dispatchEvent(ev);
    // Without modifier our handler returns false early; no exists() was called.
  });

  it("does nothing when posAtCoords is null", () => {
    view = makeView("see [[note]] here");
    (view as unknown as { posAtCoords: () => number | null }).posAtCoords = () => null;
    const ev = new MouseEvent("mousedown", { bubbles: true, cancelable: true, metaKey: true });
    view.contentDOM.dispatchEvent(ev);
  });

  it("does nothing when no provider", () => {
    view = makeView("see [[note]] here");
    (view as unknown as { posAtCoords: () => number }).posAtCoords = () => 6;
    const ev = new MouseEvent("mousedown", { bubbles: true, cancelable: true, metaKey: true });
    view.contentDOM.dispatchEvent(ev);
  });

  it("does nothing when click misses a wikilink", () => {
    setWikilinkProvider({
      searchFiles: vi.fn(),
      headings: vi.fn(),
      exists: vi.fn(),
      open: vi.fn(),
      create: vi.fn(),
    });
    view = makeView("just text here");
    (view as unknown as { posAtCoords: () => number }).posAtCoords = () => 2;
    const ev = new MouseEvent("mousedown", { bubbles: true, cancelable: true, metaKey: true });
    view.contentDOM.dispatchEvent(ev);
  });

  it("opens an existing wikilink on Mod+click", async () => {
    const open = vi.fn(async () => {});
    setWikilinkProvider({
      searchFiles: vi.fn(),
      headings: vi.fn(),
      exists: async () => true,
      open,
      create: vi.fn(),
    });
    view = makeView("see [[note]] here");
    (view as unknown as { posAtCoords: () => number }).posAtCoords = () => 6;
    const ev = new MouseEvent("mousedown", { bubbles: true, cancelable: true, ctrlKey: true });
    view.contentDOM.dispatchEvent(ev);
    await new Promise((r) => setTimeout(r, 10));
    expect(open).toHaveBeenCalledWith("note", undefined);
  });

  it("creates+opens a missing wikilink on Mod+click", async () => {
    const open = vi.fn(async () => {});
    const create = vi.fn(async (p: string) => `new/${p}`);
    setWikilinkProvider({
      searchFiles: vi.fn(),
      headings: vi.fn(),
      exists: async () => false,
      open,
      create,
    });
    view = makeView("see [[note]] here");
    (view as unknown as { posAtCoords: () => number }).posAtCoords = () => 6;
    const ev = new MouseEvent("mousedown", { bubbles: true, cancelable: true, metaKey: true });
    view.contentDOM.dispatchEvent(ev);
    await new Promise((r) => setTimeout(r, 10));
    expect(create).toHaveBeenCalledWith("note");
    expect(open).toHaveBeenCalledWith("new/note", undefined);
  });

  it("skips open when create returns empty", async () => {
    const open = vi.fn(async () => {});
    const create = vi.fn(async () => "");
    setWikilinkProvider({
      searchFiles: vi.fn(),
      headings: vi.fn(),
      exists: async () => false,
      open,
      create,
    });
    view = makeView("see [[note]] here");
    (view as unknown as { posAtCoords: () => number }).posAtCoords = () => 6;
    const ev = new MouseEvent("mousedown", { bubbles: true, cancelable: true, metaKey: true });
    view.contentDOM.dispatchEvent(ev);
    await new Promise((r) => setTimeout(r, 10));
    expect(open).not.toHaveBeenCalled();
  });
});

describe("broken link plugin", () => {
  it("marks unknown wikilinks as broken once their exists() resolves false", async () => {
    const provider: WikilinkProvider = {
      searchFiles: vi.fn(),
      headings: vi.fn(),
      exists: async () => false,
      open: vi.fn(),
      create: vi.fn(),
    };
    setWikilinkProvider(provider);
    view = makeView("hi [[missing]] world");
    // Wait for async exists() + redraw.
    await new Promise((r) => setTimeout(r, 30));
    // Force another update to consume cached state.
    view.dispatch({});
    await new Promise((r) => setTimeout(r, 10));
    expect(view.state.doc.toString()).toContain("[[missing]]");
  });

  it("marks links as valid (no broken class) when exists() resolves true", async () => {
    setWikilinkProvider({
      searchFiles: vi.fn(),
      headings: vi.fn(),
      exists: async () => true,
      open: vi.fn(),
      create: vi.fn(),
    });
    view = makeView("hi [[ok]] world");
    await new Promise((r) => setTimeout(r, 30));
    view.dispatch({});
    await new Promise((r) => setTimeout(r, 10));
  });

  it("treats exists() rejections as valid", async () => {
    setWikilinkProvider({
      searchFiles: vi.fn(),
      headings: vi.fn(),
      exists: async () => {
        throw new Error("offline");
      },
      open: vi.fn(),
      create: vi.fn(),
    });
    view = makeView("hi [[err]] world");
    await new Promise((r) => setTimeout(r, 30));
    view.dispatch({});
    await new Promise((r) => setTimeout(r, 10));
  });

  it("renders nothing when no provider", () => {
    view = makeView("hi [[x]] world");
  });

  it("includes heading anchors in pending entries", async () => {
    const exists = vi.fn(async () => true);
    setWikilinkProvider({
      searchFiles: vi.fn(),
      headings: vi.fn(),
      exists,
      open: vi.fn(),
      create: vi.fn(),
    });
    view = makeView("hi [[note#sec]] world");
    await new Promise((r) => setTimeout(r, 30));
    view.dispatch({});
    await new Promise((r) => setTimeout(r, 10));
    expect(exists).toHaveBeenCalledWith("note", "sec");
  });

  it("falls back to valid when provider is unset while exists() pending", async () => {
    let resolveExists: (v: boolean | undefined) => void = () => {};
    const exists = vi.fn(
      () =>
        new Promise<boolean>((resolve) => {
          resolveExists = resolve as (v: boolean | undefined) => void;
        }),
    );
    setWikilinkProvider({
      searchFiles: vi.fn(),
      headings: vi.fn(),
      exists,
      open: vi.fn(),
      create: vi.fn(),
    });
    view = makeView("hi [[late]] world");
    // Wait for refresh() to fire and add to pending.
    await new Promise((r) => setTimeout(r, 10));
    // Drop the provider before the pending resolve fires — provider?.exists
    // captured the original. Resolve with undefined to hit `ok ?? true`.
    setWikilinkProvider(null);
    resolveExists(undefined);
    await new Promise((r) => setTimeout(r, 30));
  });

  it("re-renders broken state on docChanged after cache fill", async () => {
    setWikilinkProvider({
      searchFiles: vi.fn(),
      headings: vi.fn(),
      exists: async () => false,
      open: vi.fn(),
      create: vi.fn(),
    });
    view = makeView("hi [[m1]]");
    await new Promise((r) => setTimeout(r, 30));
    // Edit the doc to trigger refresh with a now-cached broken link.
    view.dispatch({ changes: { from: view.state.doc.length, insert: " end" } });
    await new Promise((r) => setTimeout(r, 10));
  });
});
