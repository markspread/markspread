import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { PaneNode } from "../lib/editor/layout-model";
import type { EditorPosition } from "../store/tabs";

const invokeMock = vi.fn();
vi.mock("@tauri-apps/api/core", () => ({
  invoke: (cmd: string, args: unknown) => invokeMock(cmd, args),
  convertFileSrc: (p: string) => p,
}));

interface SelectionRange {
  fromOffset: number;
  toOffset: number;
  fullText: string;
}
let lastEditorProps: {
  initialDoc: string;
  onChange?: (n: string) => void;
  onPositionChange?: (p: EditorPosition) => void;
  onSelectionRange?: (range: SelectionRange) => void;
  remoteDoc?: string;
  language?: string;
  path?: string;
  readOnly?: boolean;
  initialPosition?: EditorPosition;
  tabId?: string;
} | null = null;
vi.mock("./Editor", () => ({
  Editor: (props: {
    initialDoc: string;
    onChange?: (n: string) => void;
    onPositionChange?: (p: EditorPosition) => void;
    onSelectionRange?: (range: SelectionRange) => void;
    remoteDoc?: string;
    language?: string;
    path?: string;
    readOnly?: boolean;
    initialPosition?: EditorPosition;
    tabId?: string;
  }) => {
    lastEditorProps = props;
    return <div data-testid="editor-mock">{props.initialDoc}</div>;
  },
}));
vi.mock("./SpreadPane", () => ({
  SpreadPane: ({ content }: { content: string }) => <div data-testid="spread-mock">{content}</div>,
}));

const saveTabMock = vi.fn<(args: unknown) => Promise<unknown>>(() => Promise.resolve(undefined));
vi.mock("../lib/save-tab", () => ({
  saveTab: (args: unknown) => saveTabMock(args),
}));

type ExternalChangeResult =
  | { kind: "unchanged" }
  | { kind: "modified"; baselineMs: number; currentMs: number }
  | { kind: "deleted"; baselineMs: number | null };
const detectExternalChangeMock = vi.fn<(...args: unknown[]) => Promise<ExternalChangeResult>>(
  async () => ({ kind: "unchanged" }),
);
vi.mock("../lib/external-change", () => ({
  detectExternalChange: (...args: unknown[]) => detectExternalChangeMock(...args),
}));

import { useDocCache } from "../store/doc-cache";
import { useDragChatSelection } from "../store/drag-chat-selection";
import { useEditorLayout } from "../store/editor-layout";
import { useTabs } from "../store/tabs";
import { useToasts } from "../store/toasts";
import { useWorkspace } from "../store/workspace";
import { PaneEditor } from "./PaneEditor";

afterEach(cleanup);

const POS: EditorPosition = { line: 0, column: 0, scrollTop: 0 };

function paneWith(path: string | null, tabId = "tab-1"): PaneNode {
  if (!path) return { type: "pane", id: "pane-1", tabs: [], activeTabId: null };
  return {
    type: "pane",
    id: "pane-1",
    tabs: [{ id: tabId, path, position: POS }],
    activeTabId: tabId,
  };
}

describe("PaneEditor", () => {
  beforeEach(() => {
    useDocCache.setState({ baselines: {}, live: {}, errors: {}, reloadEpoch: {} });
    useTabs.setState({ tabs: [], activePath: null });
    useWorkspace.setState({ readOnly: false });
    useToasts.setState({ toasts: [] });
    invokeMock.mockReset();
    saveTabMock.mockReset();
    saveTabMock.mockResolvedValue(undefined);
    detectExternalChangeMock.mockReset();
    detectExternalChangeMock.mockResolvedValue({ kind: "unchanged" });
    lastEditorProps = null;
  });

  it("renders the empty hint when no tab is active", () => {
    render(<PaneEditor workspace="/ws" pane={paneWith(null)} />);
    expect(screen.getByText("Open a file from the sidebar to start reviewing.")).toBeTruthy();
  });

  it("renders the loading state before the baseline arrives", () => {
    invokeMock.mockReturnValue(new Promise(() => {}));
    render(<PaneEditor workspace="/ws" pane={paneWith("/ws/a.md")} />);
    expect(screen.getByText("Loading…")).toBeTruthy();
  });

  it("loads the baseline through the IPC call when first opened", async () => {
    invokeMock.mockResolvedValue({
      content: "hello",
      encoding: "utf-8",
      mtime: 1,
      sha256: "x",
    });
    render(<PaneEditor workspace="/ws" pane={paneWith("/ws/a.md")} />);
    await waitFor(() => expect(screen.getByTestId("editor-mock")).toBeTruthy());
    expect(screen.getByTestId("editor-mock").textContent).toBe("hello");
  });

  it("falls back to a null mtime/sha when the IPC omits them", async () => {
    invokeMock.mockResolvedValue({ content: "minimal", encoding: "utf-8" });
    render(<PaneEditor workspace="/ws" pane={paneWith("/ws/min.md")} />);
    await waitFor(() => expect(screen.getByTestId("editor-mock")).toBeTruthy());
    const cached = useDocCache.getState().baselines["/ws::/ws/min.md"];
    expect(cached?.mtime).toBeNull();
    expect(cached?.sha256).toBeNull();
  });

  it("surfaces a read error via the access card", async () => {
    invokeMock.mockRejectedValue("EACCES");
    render(<PaneEditor workspace="/ws" pane={paneWith("/ws/locked.md")} />);
    await waitFor(() => expect(screen.getByLabelText("Editor error")).toBeTruthy());
  });

  it("retries via the access card", async () => {
    invokeMock.mockRejectedValueOnce("EACCES");
    render(<PaneEditor workspace="/ws" pane={paneWith("/ws/locked.md")} />);
    await waitFor(() => expect(screen.getByLabelText("Editor error")).toBeTruthy());
    invokeMock.mockResolvedValueOnce({ content: "ok", encoding: "utf-8" });
    const retry = screen.getByRole("button", { name: /retry/i });
    fireEvent.click(retry);
    await waitFor(() => expect(screen.getByTestId("editor-mock")).toBeTruthy());
  });

  it("copies diagnostics from the access card", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "clipboard", {
      value: { writeText },
      configurable: true,
    });
    invokeMock.mockRejectedValue({
      access: { ruleId: "SEC-NULL-BYTE", category: "SEC" },
    });
    render(<PaneEditor workspace="/ws" pane={paneWith("/ws/bad.md")} />);
    await waitFor(() => expect(screen.getByLabelText("Editor error")).toBeTruthy());
    fireEvent.click(screen.getByRole("button", { name: /copy_diagnostics|copy diagnostics/i }));
    expect(writeText).toHaveBeenCalled();
  });

  it("renders the editor once a baseline is cached", () => {
    useDocCache.getState().setBaseline("/ws", "/ws/a.md", {
      content: "hello",
      encoding: "utf-8",
      mtime: 1,
      sha256: "x",
    });
    render(<PaneEditor workspace="/ws" pane={paneWith("/ws/a.md")} />);
    expect(screen.getByTestId("editor-mock")).toBeTruthy();
  });

  it("renders the non-text viewer for image files", () => {
    render(<PaneEditor workspace="/ws" pane={paneWith("/ws/pic.png")} />);
    expect(screen.getByLabelText("Image preview")).toBeTruthy();
  });

  it("uses the plain language for non-markdown files", () => {
    useDocCache.getState().setBaseline("/ws", "/ws/notes.txt", {
      content: "log",
      encoding: "utf-8",
      mtime: 0,
      sha256: "",
    });
    render(<PaneEditor workspace="/ws" pane={paneWith("/ws/notes.txt")} />);
    expect(lastEditorProps?.language).toBe("plain");
  });

  it("mounts non-md code files read-only with the path for lazy highlight (ADR-0014 T2.c)", () => {
    useDocCache.getState().setBaseline("/ws", "/ws/src/main.ts", {
      content: "const a = 1;",
      encoding: "utf-8",
      mtime: 0,
      sha256: "",
    });
    render(<PaneEditor workspace="/ws" pane={paneWith("/ws/src/main.ts")} />);
    expect(lastEditorProps?.language).toBe("plain");
    expect(lastEditorProps?.path).toBe("/ws/src/main.ts");
    expect(lastEditorProps?.readOnly).toBe(true);
  });

  it("toggles to spread view when the toggle is clicked", () => {
    useDocCache.getState().setBaseline("/ws", "/ws/a.md", {
      content: "x",
      encoding: "utf-8",
      mtime: 0,
      sha256: "",
    });
    render(<PaneEditor workspace="/ws" pane={paneWith("/ws/a.md")} />);
    expect(screen.queryByTestId("spread-mock")).toBeNull();
    fireEvent.click(screen.getByRole("radio", { name: "Spread" }));
    expect(screen.getByTestId("spread-mock")).toBeTruthy();
    fireEvent.click(screen.getByRole("radio", { name: "Preview" }));
    expect(screen.getByTestId("spread-mock")).toBeTruthy();
    expect(screen.queryByTestId("editor-mock")).toBeNull();
    fireEvent.click(screen.getByRole("radio", { name: "Edit" }));
    expect(screen.getByTestId("editor-mock")).toBeTruthy();
  });

  it("forwards onChange edits to the doc cache and arms a save", async () => {
    vi.useFakeTimers();
    try {
      useDocCache.getState().setBaseline("/ws", "/ws/a.md", {
        content: "old",
        encoding: "utf-8",
        mtime: 0,
        sha256: "",
      });
      render(<PaneEditor workspace="/ws" pane={paneWith("/ws/a.md")} />);
      act(() => lastEditorProps?.onChange?.("new"));
      expect(useDocCache.getState().getLive("/ws", "/ws/a.md")).toBe("new");
      await act(async () => {
        await vi.advanceTimersByTimeAsync(700);
      });
      expect(saveTabMock).toHaveBeenCalledWith(
        expect.objectContaining({ path: "/ws/a.md", content: "new" }),
      );
    } finally {
      vi.useRealTimers();
    }
  });

  it("skips saving when the content matches the baseline", async () => {
    vi.useFakeTimers();
    try {
      useDocCache.getState().setBaseline("/ws", "/ws/a.md", {
        content: "same",
        encoding: "utf-8",
        mtime: 0,
        sha256: "",
      });
      render(<PaneEditor workspace="/ws" pane={paneWith("/ws/a.md")} />);
      act(() => lastEditorProps?.onChange?.("same"));
      await act(async () => {
        await vi.advanceTimersByTimeAsync(700);
      });
      expect(saveTabMock).not.toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
  });

  it("skips saving in read-only mode", async () => {
    vi.useFakeTimers();
    try {
      useWorkspace.setState({ readOnly: true });
      useDocCache.getState().setBaseline("/ws", "/ws/a.md", {
        content: "x",
        encoding: "utf-8",
        mtime: 0,
        sha256: "",
      });
      render(<PaneEditor workspace="/ws" pane={paneWith("/ws/a.md")} />);
      act(() => lastEditorProps?.onChange?.("xy"));
      await act(async () => {
        await vi.advanceTimersByTimeAsync(700);
      });
      expect(saveTabMock).not.toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
  });

  it("warns and pauses save when the file was modified on disk", async () => {
    vi.useFakeTimers();
    try {
      detectExternalChangeMock.mockResolvedValue({
        kind: "modified",
        baselineMs: 1000,
        currentMs: 2000,
      });
      useDocCache.getState().setBaseline("/ws", "/ws/a.md", {
        content: "old",
        encoding: "utf-8",
        mtime: 1000,
        sha256: "",
      });
      render(<PaneEditor workspace="/ws" pane={paneWith("/ws/a.md")} />);
      act(() => lastEditorProps?.onChange?.("new"));
      await act(async () => {
        await vi.advanceTimersByTimeAsync(700);
      });
      expect(saveTabMock).not.toHaveBeenCalled();
      expect(useToasts.getState().toasts.length).toBeGreaterThan(0);
    } finally {
      vi.useRealTimers();
    }
  });

  it("warns and pauses save when the file was deleted on disk", async () => {
    vi.useFakeTimers();
    try {
      detectExternalChangeMock.mockResolvedValue({ kind: "deleted", baselineMs: 1000 });
      useDocCache.getState().setBaseline("/ws", "/ws/a.md", {
        content: "old",
        encoding: "utf-8",
        mtime: 1000,
        sha256: "",
      });
      render(<PaneEditor workspace="/ws" pane={paneWith("/ws/a.md")} />);
      act(() => lastEditorProps?.onChange?.("new"));
      await act(async () => {
        await vi.advanceTimersByTimeAsync(700);
      });
      expect(saveTabMock).not.toHaveBeenCalled();
      const toasts = useToasts.getState().toasts;
      expect(toasts[0]?.message).toMatch(/deleted/i);
    } finally {
      vi.useRealTimers();
    }
  });

  it("forwards cursor + scroll updates to the editor-layout store", () => {
    const setTabPosition = vi.spyOn(useEditorLayout.getState(), "setTabPosition");
    useDocCache.getState().setBaseline("/ws", "/ws/a.md", {
      content: "x",
      encoding: "utf-8",
      mtime: 0,
      sha256: "",
    });
    render(<PaneEditor workspace="/ws" pane={paneWith("/ws/a.md")} />);
    act(() => lastEditorProps?.onPositionChange?.({ line: 2, column: 3, scrollTop: 40 }));
    expect(setTabPosition).toHaveBeenCalledWith(
      "/ws",
      "pane-1",
      "tab-1",
      expect.objectContaining({ line: 2, column: 3, scrollTop: 40 }),
    );
    setTabPosition.mockRestore();
  });

  it("drops a successful read when the pane unmounts mid-flight", async () => {
    let resolve: (v: unknown) => void = () => {};
    invokeMock.mockReturnValue(
      new Promise((r) => {
        resolve = r;
      }),
    );
    const { unmount } = render(<PaneEditor workspace="/ws" pane={paneWith("/ws/slow.md")} />);
    unmount();
    await act(async () => {
      resolve({ content: "late", encoding: "utf-8" });
      await Promise.resolve();
    });
    expect(useDocCache.getState().baselines["/ws::/ws/slow.md"]).toBeUndefined();
  });

  it("drops a read error when the pane unmounts mid-flight", async () => {
    let reject: (e: unknown) => void = () => {};
    invokeMock.mockReturnValue(
      new Promise((_r, rj) => {
        reject = rj;
      }),
    );
    const { unmount } = render(<PaneEditor workspace="/ws" pane={paneWith("/ws/slow.md")} />);
    unmount();
    await act(async () => {
      reject("EACCES");
      await Promise.resolve();
    });
    expect(useDocCache.getState().errors["/ws::/ws/slow.md"]).toBeUndefined();
  });

  it("renders the editor without an initialPosition when the tab has none", () => {
    useDocCache.getState().setBaseline("/ws", "/ws/a.md", {
      content: "x",
      encoding: "utf-8",
      mtime: 0,
      sha256: "",
    });
    // Simulate a legacy/restored tab where `position` has not been set yet —
    // the layout type marks it required, but at runtime the field may be
    // missing from persisted state, so PaneEditor must guard for that.
    const pane: PaneNode = {
      type: "pane",
      id: "pane-1",
      tabs: [{ id: "tab-1", path: "/ws/a.md" } as unknown as PaneNode["tabs"][number]],
      activeTabId: "tab-1",
    };
    render(<PaneEditor workspace="/ws" pane={pane} />);
    expect(lastEditorProps?.initialPosition).toBeUndefined();
  });

  it("save path resolves when the baseline has a null mtime", async () => {
    vi.useFakeTimers();
    try {
      useDocCache.getState().setBaseline("/ws", "/ws/a.md", {
        content: "old",
        encoding: "utf-8",
        mtime: null,
        sha256: null,
      });
      render(<PaneEditor workspace="/ws" pane={paneWith("/ws/a.md")} />);
      act(() => lastEditorProps?.onChange?.("new"));
      await act(async () => {
        await vi.advanceTimersByTimeAsync(700);
      });
      expect(detectExternalChangeMock).toHaveBeenCalledWith("/ws", "/ws/a.md", null);
      expect(saveTabMock).toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
  });

  it("captures a drag-chat selection range for markdown files", () => {
    const capture = vi.spyOn(useDragChatSelection.getState(), "capture");
    useDocCache.getState().setBaseline("/ws", "/ws/a.md", {
      content: "hello world",
      encoding: "utf-8",
      mtime: 0,
      sha256: "",
    });
    render(<PaneEditor workspace="/ws" pane={paneWith("/ws/a.md")} />);
    act(() =>
      lastEditorProps?.onSelectionRange?.({
        fromOffset: 0,
        toOffset: 5,
        fullText: "hello world",
      }),
    );
    expect(capture).toHaveBeenCalledWith(
      expect.objectContaining({
        filePath: "/ws/a.md",
        fullText: "hello world",
        fromOffset: 0,
        toOffset: 5,
      }),
    );
    capture.mockRestore();
  });

  it("does not pass onSelectionRange for non-markdown files", () => {
    useDocCache.getState().setBaseline("/ws", "/ws/notes.txt", {
      content: "log",
      encoding: "utf-8",
      mtime: 0,
      sha256: "",
    });
    render(<PaneEditor workspace="/ws" pane={paneWith("/ws/notes.txt")} />);
    expect(lastEditorProps?.onSelectionRange).toBeUndefined();
  });

  it("uses the cached live content as the remote-doc when one pane edits", () => {
    useDocCache.getState().setBaseline("/ws", "/ws/a.md", {
      content: "base",
      encoding: "utf-8",
      mtime: 0,
      sha256: "",
    });
    useDocCache.getState().setLive("/ws", "/ws/a.md", "live");
    render(<PaneEditor workspace="/ws" pane={paneWith("/ws/a.md")} />);
    expect(lastEditorProps?.remoteDoc).toBe("live");
  });
});
