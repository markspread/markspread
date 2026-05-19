import "../extensions/jsdomLayoutShim";
// S-MD-007..009: tests for link insertion.

import { EditorState, type EditorStateConfig } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  type LinkDialogRequest,
  type WorkspaceLinkProvider,
  getWorkspaceLinkProvider,
  insertLink,
  setLinkDialogOpener,
  setWorkspaceLinkProvider,
} from "./link";

function mount(doc: string, selection?: NonNullable<EditorStateConfig["selection"]>): EditorView {
  return new EditorView({
    state: EditorState.create(selection ? { doc, selection } : { doc }),
  });
}

afterEach(() => {
  setLinkDialogOpener(() => {});
  setWorkspaceLinkProvider(null);
  vi.unstubAllGlobals();
});

describe("setWorkspaceLinkProvider", () => {
  it("stores and returns the provider", () => {
    const provider: WorkspaceLinkProvider = {
      search: () => Promise.resolve([]),
      toRelative: (p) => p,
    };
    setWorkspaceLinkProvider(provider);
    expect(getWorkspaceLinkProvider()).toBe(provider);
    setWorkspaceLinkProvider(null);
    expect(getWorkspaceLinkProvider()).toBeNull();
  });
});

describe("insertLink", () => {
  it("inserts a markdown link using the selection as text", async () => {
    const view = mount("click here", { anchor: 0, head: 10 });
    setLinkDialogOpener((req: LinkDialogRequest) => {
      req.resolve({ text: req.initialText, url: "https://x.com" });
    });
    expect(await insertLink(view)).toBe(true);
    expect(view.state.doc.toString()).toBe("[click here](https://x.com)");
    view.destroy();
  });

  it("falls back to the url as text when text is empty", async () => {
    const view = mount("");
    setLinkDialogOpener((req: LinkDialogRequest) => {
      req.resolve({ text: "", url: "https://x.com" });
    });
    await insertLink(view);
    expect(view.state.doc.toString()).toBe("[https://x.com](https://x.com)");
    view.destroy();
  });

  it("includes an escaped title when supplied", async () => {
    const view = mount("");
    setLinkDialogOpener((req: LinkDialogRequest) => {
      req.resolve({ text: "t", url: "u", title: 'a "b" c' });
    });
    await insertLink(view);
    expect(view.state.doc.toString()).toBe('[t](u "a \\"b\\" c")');
    view.destroy();
  });

  it("returns false when the dialog is cancelled", async () => {
    const view = mount("abc");
    setLinkDialogOpener((req: LinkDialogRequest) => req.resolve(null));
    expect(await insertLink(view)).toBe(false);
    expect(view.state.doc.toString()).toBe("abc");
    view.destroy();
  });

  it("prefills the url from a URL-shaped clipboard value", async () => {
    vi.stubGlobal("navigator", {
      clipboard: { readText: () => Promise.resolve("https://from-clipboard.com") },
    });
    const view = mount("");
    let prefilled = "";
    setLinkDialogOpener((req: LinkDialogRequest) => {
      prefilled = req.initialUrl;
      req.resolve(null);
    });
    await insertLink(view);
    expect(prefilled).toBe("https://from-clipboard.com");
    view.destroy();
  });

  it("ignores a non-URL clipboard value", async () => {
    vi.stubGlobal("navigator", {
      clipboard: { readText: () => Promise.resolve("just some text") },
    });
    const view = mount("");
    let prefilled = "unset";
    setLinkDialogOpener((req: LinkDialogRequest) => {
      prefilled = req.initialUrl;
      req.resolve(null);
    });
    await insertLink(view);
    expect(prefilled).toBe("");
    view.destroy();
  });

  it("treats a clipboard read failure as best-effort", async () => {
    vi.stubGlobal("navigator", {
      clipboard: {
        readText: () => Promise.reject(new Error("denied")),
      },
    });
    const view = mount("");
    let prefilled = "unset";
    setLinkDialogOpener((req: LinkDialogRequest) => {
      prefilled = req.initialUrl;
      req.resolve(null);
    });
    await insertLink(view);
    expect(prefilled).toBe("");
    view.destroy();
  });
});
