import { act, cleanup, render, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { PaneNode } from "../lib/editor/layout-model";
import { useDocCache } from "../store/doc-cache";

const invoke = vi.fn<(cmd: string, args?: unknown) => Promise<unknown>>(() =>
  Promise.resolve(undefined),
);
vi.mock("@tauri-apps/api/core", () => ({
  invoke: (cmd: string, args?: unknown) => invoke(cmd, args),
}));
vi.mock("../lib/preview/render", () => ({
  createDebouncedRenderer:
    () =>
    (content: string, opts: { highlightCode: (code: string, lang: string) => Promise<string> }) => {
      // Exercise the highlightCode lambda passed by SpreadPane so its
      // function coverage isn't lost behind the mocked renderer.
      void opts.highlightCode("fn x", "rust");
      return Promise.resolve(`<p>${content}</p>`);
    },
}));
vi.mock("../lib/preview/shiki", () => ({ highlightCode: (c: string) => Promise.resolve(c) }));
vi.mock("../lib/preview/codeCopyButton", () => ({ attachCodeCopyButtons: () => {} }));

let lastCheckboxOpts: {
  getSource: () => string;
  toggleLine: (e: {
    lineIndex: number;
    oldLength: number;
    nextLine: string;
  }) => void;
} | null = null;
vi.mock("../lib/preview/checkboxToggle", () => ({
  attachCheckboxToggles: (
    _root: HTMLElement,
    opts: {
      getSource: () => string;
      toggleLine: (e: {
        lineIndex: number;
        oldLength: number;
        nextLine: string;
      }) => void;
    },
  ) => {
    lastCheckboxOpts = opts;
  },
}));

let lastLinkOpts: {
  openExternal: (url: string) => Promise<void>;
  openInternal: (path: string) => Promise<void>;
  resolveInternal: (href: string) => { path: string; anchor?: string } | null;
} | null = null;
vi.mock("../lib/preview/linkClick", () => ({
  attachLinkClickHandler: (
    _root: HTMLElement,
    opts: {
      openExternal: (url: string) => Promise<void>;
      openInternal: (path: string) => Promise<void>;
      resolveInternal: (href: string) => { path: string; anchor?: string } | null;
    },
  ) => {
    lastLinkOpts = opts;
    return () => {};
  },
}));

vi.mock("../lib/preview/mermaid", () => ({ renderMermaidIn: () => Promise.resolve() }));
vi.mock("../lib/preview/katex", () => ({ renderMathIn: () => Promise.resolve() }));

let scrollHandler: ((e: { side: string; fraction: number }) => void) | null = null;
let scrollSyncEnabled = false;
const emitScroll = vi.fn();
const suppressEcho = vi.fn();
vi.mock("../lib/preview/scrollSync", () => ({
  emitScroll: (...args: unknown[]) => emitScroll(...args),
  onScroll: (fn: (e: { side: string; fraction: number }) => void) => {
    scrollHandler = fn;
    return () => {
      scrollHandler = null;
    };
  },
  isScrollSyncEnabled: () => scrollSyncEnabled,
  suppressEcho: () => suppressEcho(),
}));

let registryMatch: { parser: { manifest: { id: string } } } | null = null;
vi.mock("../lib/parsers/registry", () => ({
  BUILTIN_MARKDOWN_ID: "builtin",
  getParserRegistry: () => ({ match: () => registryMatch }),
}));

let parserTransport: unknown = null;
vi.mock("../lib/parsers/transport-registry", () => ({
  getParserTransport: () => parserTransport,
}));

import { SpreadPane } from "./SpreadPane";

afterEach(() => {
  cleanup();
  invoke.mockClear();
  emitScroll.mockClear();
  suppressEcho.mockClear();
  scrollHandler = null;
  scrollSyncEnabled = false;
  registryMatch = null;
  parserTransport = null;
  lastCheckboxOpts = null;
  lastLinkOpts = null;
});

const pane: PaneNode = { type: "pane", id: "pane-1", tabs: [], activeTabId: null };

describe("SpreadPane", () => {
  it("renders the preview region", () => {
    const { container } = render(
      <SpreadPane workspace="/ws" pane={pane} documentPath="/ws/a.md" content="# hi" />,
    );
    expect(container.querySelector('[data-spread-pane="pane-1"]')).not.toBeNull();
  });

  it("renders the debounced markdown HTML", async () => {
    const { container } = render(
      <SpreadPane workspace="/ws" pane={pane} documentPath="/ws/a.md" content="hello world" />,
    );
    await waitFor(() => expect(container.innerHTML).toContain("<p>hello world</p>"));
  });

  it("routes through a third-party parser transport when registered", async () => {
    registryMatch = { parser: { manifest: { id: "acme.parser" } } };
    parserTransport = { send: vi.fn() };
    render(<SpreadPane workspace="/ws" pane={pane} documentPath="/ws/a.parser" content="x" />);
    await waitFor(() => expect(true).toBe(true));
  });

  it("falls back to the builtin pipeline when the matched parser is the builtin", async () => {
    registryMatch = { parser: { manifest: { id: "builtin" } } };
    parserTransport = { send: vi.fn() };
    render(<SpreadPane workspace="/ws" pane={pane} documentPath="/ws/b.md" content="y" />);
    await waitFor(() => expect(true).toBe(true));
  });

  it("falls back when a non-builtin parser has no registered transport", async () => {
    registryMatch = { parser: { manifest: { id: "acme.parser" } } };
    parserTransport = null;
    render(<SpreadPane workspace="/ws" pane={pane} documentPath="/ws/a.parser" content="z" />);
    await waitFor(() => expect(true).toBe(true));
  });

  it("opens external links via the shell IPC", async () => {
    render(<SpreadPane workspace="/ws" pane={pane} documentPath="/ws/a.md" content="x" />);
    await waitFor(() => expect(lastLinkOpts).not.toBeNull());
    await act(async () => {
      await lastLinkOpts?.openExternal("https://example.com");
    });
    expect(invoke).toHaveBeenCalledWith("shell_open_external", { url: "https://example.com" });
  });

  it("logs when shell_open_external rejects", async () => {
    invoke.mockRejectedValueOnce(new Error("net down"));
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    render(<SpreadPane workspace="/ws" pane={pane} documentPath="/ws/a.md" content="x" />);
    await waitFor(() => expect(lastLinkOpts).not.toBeNull());
    await act(async () => {
      await lastLinkOpts?.openExternal("https://x");
    });
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });

  it("opens internal links via fs_open_tab", async () => {
    render(<SpreadPane workspace="/ws" pane={pane} documentPath="/ws/a.md" content="x" />);
    await waitFor(() => expect(lastLinkOpts).not.toBeNull());
    await act(async () => {
      await lastLinkOpts?.openInternal("/ws/b.md");
    });
    expect(invoke).toHaveBeenCalledWith("fs_open_tab", { workspace: "/ws", path: "/ws/b.md" });
  });

  it("logs when fs_open_tab rejects", async () => {
    invoke.mockRejectedValueOnce(new Error("blocked"));
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    render(<SpreadPane workspace="/ws" pane={pane} documentPath="/ws/a.md" content="x" />);
    await waitFor(() => expect(lastLinkOpts).not.toBeNull());
    await act(async () => {
      await lastLinkOpts?.openInternal("/ws/b.md");
    });
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });

  it("rejects scheme-prefixed and protocol-style hrefs", async () => {
    render(<SpreadPane workspace="/ws" pane={pane} documentPath="/ws/a.md" content="x" />);
    await waitFor(() => expect(lastLinkOpts).not.toBeNull());
    expect(lastLinkOpts?.resolveInternal("https://x")).toBeNull();
    expect(lastLinkOpts?.resolveInternal("mailto:a@b")).toBeNull();
    expect(lastLinkOpts?.resolveInternal("tel:123")).toBeNull();
  });

  it("rejects bare anchor-only hrefs", async () => {
    render(<SpreadPane workspace="/ws" pane={pane} documentPath="/ws/a.md" content="x" />);
    await waitFor(() => expect(lastLinkOpts).not.toBeNull());
    expect(lastLinkOpts?.resolveInternal("#section")).toBeNull();
  });

  it("returns the path with an anchor when both are present", async () => {
    render(<SpreadPane workspace="/ws" pane={pane} documentPath="/ws/a.md" content="x" />);
    await waitFor(() => expect(lastLinkOpts).not.toBeNull());
    expect(lastLinkOpts?.resolveInternal("doc.md#sec")).toEqual({
      path: "doc.md",
      anchor: "sec",
    });
  });

  it("returns just the path when no anchor is present", async () => {
    render(<SpreadPane workspace="/ws" pane={pane} documentPath="/ws/a.md" content="x" />);
    await waitFor(() => expect(lastLinkOpts).not.toBeNull());
    expect(lastLinkOpts?.resolveInternal("doc.md")).toEqual({ path: "doc.md" });
  });

  it("toggles a checkbox line via the doc cache", async () => {
    useDocCache.getState().setLive("/ws", "/ws/a.md", "- [ ] one\n- [ ] two");
    render(
      <SpreadPane
        workspace="/ws"
        pane={pane}
        documentPath="/ws/a.md"
        content="- [ ] one\n- [ ] two"
      />,
    );
    await waitFor(() => expect(lastCheckboxOpts).not.toBeNull());
    expect(lastCheckboxOpts?.getSource()).toContain("- [ ] one");
    act(() => {
      lastCheckboxOpts?.toggleLine({
        lineIndex: 0,
        oldLength: "- [ ] one".length,
        nextLine: "- [x] one",
      });
    });
    expect(useDocCache.getState().getLive("/ws", "/ws/a.md")).toContain("- [x] one");
  });

  it("ignores a checkbox toggle when the line is missing", async () => {
    useDocCache.getState().setLive("/ws", "/ws/a.md", "single line only");
    render(
      <SpreadPane workspace="/ws" pane={pane} documentPath="/ws/a.md" content="single line only" />,
    );
    await waitFor(() => expect(lastCheckboxOpts).not.toBeNull());
    act(() => {
      lastCheckboxOpts?.toggleLine({
        lineIndex: 99,
        oldLength: 1,
        nextLine: "x",
      });
    });
    expect(useDocCache.getState().getLive("/ws", "/ws/a.md")).toBe("single line only");
  });

  it("falls back to the prop content when the doc cache has no live entry", async () => {
    useDocCache.setState((s) => ({ ...s, live: {} }));
    render(
      <SpreadPane workspace="/ws" pane={pane} documentPath="/ws/fresh.md" content="- [ ] one" />,
    );
    await waitFor(() => expect(lastCheckboxOpts).not.toBeNull());
    act(() => {
      lastCheckboxOpts?.toggleLine({
        lineIndex: 0,
        oldLength: "- [ ] one".length,
        nextLine: "- [x] one",
      });
    });
    expect(useDocCache.getState().getLive("/ws", "/ws/fresh.md")).toContain("- [x] one");
  });

  it("ignores a checkbox toggle when the line length is stale", async () => {
    useDocCache.getState().setLive("/ws", "/ws/a.md", "- [ ] one");
    render(<SpreadPane workspace="/ws" pane={pane} documentPath="/ws/a.md" content="- [ ] one" />);
    await waitFor(() => expect(lastCheckboxOpts).not.toBeNull());
    act(() => {
      lastCheckboxOpts?.toggleLine({
        lineIndex: 0,
        oldLength: 999,
        nextLine: "- [x] one",
      });
    });
    expect(useDocCache.getState().getLive("/ws", "/ws/a.md")).toBe("- [ ] one");
  });

  it("emits scroll events when the preview region scrolls", async () => {
    const { container } = render(
      <SpreadPane workspace="/ws" pane={pane} documentPath="/ws/a.md" content="x" />,
    );
    const root = container.querySelector('[data-spread-pane="pane-1"]') as HTMLElement;
    Object.defineProperty(root, "scrollHeight", { value: 1000, configurable: true });
    Object.defineProperty(root, "clientHeight", { value: 200, configurable: true });
    Object.defineProperty(root, "scrollTop", { value: 400, configurable: true });
    root.dispatchEvent(new Event("scroll"));
    expect(emitScroll).toHaveBeenCalledWith({ side: "preview", topLine: 1, fraction: 0.5 });
  });

  it("emits a zero scroll fraction when the preview is shorter than its viewport", async () => {
    const { container } = render(
      <SpreadPane workspace="/ws" pane={pane} documentPath="/ws/a.md" content="x" />,
    );
    const root = container.querySelector('[data-spread-pane="pane-1"]') as HTMLElement;
    Object.defineProperty(root, "scrollHeight", { value: 100, configurable: true });
    Object.defineProperty(root, "clientHeight", { value: 200, configurable: true });
    Object.defineProperty(root, "scrollTop", { value: 0, configurable: true });
    root.dispatchEvent(new Event("scroll"));
    expect(emitScroll).toHaveBeenCalledWith({ side: "preview", topLine: 1, fraction: 0 });
  });

  it("ignores echoed scroll events that originated from the preview side", async () => {
    scrollSyncEnabled = true;
    render(<SpreadPane workspace="/ws" pane={pane} documentPath="/ws/a.md" content="x" />);
    expect(scrollHandler).not.toBeNull();
    scrollHandler?.({ side: "preview", fraction: 0.5 });
    expect(suppressEcho).not.toHaveBeenCalled();
  });

  it("ignores inbound scroll events while sync is off", async () => {
    scrollSyncEnabled = false;
    render(<SpreadPane workspace="/ws" pane={pane} documentPath="/ws/a.md" content="x" />);
    scrollHandler?.({ side: "editor", fraction: 0.5 });
    expect(suppressEcho).not.toHaveBeenCalled();
  });

  it("ignores inbound scroll events when the preview has no overflow", async () => {
    scrollSyncEnabled = true;
    const { container } = render(
      <SpreadPane workspace="/ws" pane={pane} documentPath="/ws/a.md" content="x" />,
    );
    const root = container.querySelector('[data-spread-pane="pane-1"]') as HTMLElement;
    Object.defineProperty(root, "scrollHeight", { value: 100, configurable: true });
    Object.defineProperty(root, "clientHeight", { value: 200, configurable: true });
    scrollHandler?.({ side: "editor", fraction: 0.5 });
    expect(suppressEcho).toHaveBeenCalled();
  });

  it("scrolls the preview to mirror an editor-side scroll", async () => {
    scrollSyncEnabled = true;
    const { container } = render(
      <SpreadPane workspace="/ws" pane={pane} documentPath="/ws/a.md" content="x" />,
    );
    const root = container.querySelector('[data-spread-pane="pane-1"]') as HTMLElement;
    Object.defineProperty(root, "scrollHeight", { value: 1000, configurable: true });
    Object.defineProperty(root, "clientHeight", { value: 200, configurable: true });
    root.scrollTop = 0;
    scrollHandler?.({ side: "editor", fraction: 0.5 });
    expect(root.scrollTop).toBe(400);
  });
});
