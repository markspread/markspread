import { cleanup, renderHook, waitFor } from "@testing-library/react";
import { act } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const invokeMock = vi.fn();
vi.mock("@tauri-apps/api/core", () => ({
  invoke: (cmd: string, args: unknown) => invokeMock(cmd, args),
}));

let parseEditorLayoutImpl: (raw: unknown) => unknown = () => null;
const collectPathsMock = vi.fn<(root: unknown) => string[]>(() => []);
const pruneEditorLayoutMock = vi.fn<(l: unknown, miss: (p: string) => boolean) => unknown>(
  (l: unknown) => l,
);
const serializeEditorLayoutMock = vi.fn<(l: unknown) => unknown>((l: unknown) => l);
vi.mock("../lib/editor/layout-model", () => ({
  collectPaths: (root: unknown) => collectPathsMock(root),
  parseEditorLayout: (raw: unknown) => parseEditorLayoutImpl(raw),
  pruneEditorLayout: (l: unknown, miss: (p: string) => boolean) => pruneEditorLayoutMock(l, miss),
  serializeEditorLayout: (l: unknown) => serializeEditorLayoutMock(l),
}));

import { useEditorLayout } from "../store/editor-layout";
import { useLayout } from "../store/layout";
import { useWorkspaceLayoutSync } from "./useWorkspaceLayoutSync";

describe("useWorkspaceLayoutSync", () => {
  beforeEach(() => {
    invokeMock.mockReset();
    invokeMock.mockResolvedValue(undefined);
    collectPathsMock.mockReset();
    collectPathsMock.mockReturnValue([]);
    pruneEditorLayoutMock.mockReset();
    pruneEditorLayoutMock.mockImplementation((l: unknown) => l);
    serializeEditorLayoutMock.mockReset();
    serializeEditorLayoutMock.mockImplementation((l: unknown) => l);
    parseEditorLayoutImpl = () => null;
    useLayout.setState({ sidebarHidden: {}, sidebarWidth: {}, sidebarCollapsedMode: {} });
    useEditorLayout.setState({ layouts: {} });
  });
  afterEach(() => {
    cleanup();
    vi.useRealTimers();
  });

  it("does nothing when workspace is null", () => {
    renderHook(() => useWorkspaceLayoutSync(null));
    expect(invokeMock).not.toHaveBeenCalled();
  });

  it("loads the layout payload on mount and hydrates the store", async () => {
    invokeMock.mockImplementation((cmd: string) => {
      if (cmd === "workspace_layout_load") {
        return Promise.resolve({
          sidebar: { hidden: true, width: 280, collapsedMode: "rail" },
        });
      }
      return Promise.resolve(undefined);
    });
    renderHook(() => useWorkspaceLayoutSync("/ws"));
    await waitFor(() => expect(useLayout.getState().isSidebarHidden("/ws")).toBe(true));
    expect(useLayout.getState().sidebarWidth["/ws"]).toBe(280);
  });

  it("accepts hidden collapsedMode and ignores invalid values", async () => {
    invokeMock.mockImplementation((cmd: string) =>
      cmd === "workspace_layout_load"
        ? Promise.resolve({
            sidebar: { hidden: "not a bool", width: "wide", collapsedMode: "nonsense" },
          })
        : Promise.resolve(undefined),
    );
    renderHook(() => useWorkspaceLayoutSync("/ws"));
    await waitFor(() => expect(invokeMock).toHaveBeenCalled());
    // None of the invalid values should have been adopted.
    expect(useLayout.getState().sidebarHidden["/ws"]).toBeUndefined();
    expect(useLayout.getState().sidebarWidth["/ws"]).toBeUndefined();
    expect(useLayout.getState().sidebarCollapsedMode["/ws"]).toBeUndefined();
  });

  it("adopts the hidden collapsedMode value", async () => {
    invokeMock.mockImplementation((cmd: string) =>
      cmd === "workspace_layout_load"
        ? Promise.resolve({ sidebar: { collapsedMode: "hidden" } })
        : Promise.resolve(undefined),
    );
    renderHook(() => useWorkspaceLayoutSync("/ws"));
    await waitFor(() => expect(useLayout.getState().sidebarCollapsedMode["/ws"]).toBe("hidden"));
  });

  it("returns early when the payload has no sidebar field", async () => {
    invokeMock.mockImplementation((cmd: string) =>
      cmd === "workspace_layout_load" ? Promise.resolve({}) : Promise.resolve(undefined),
    );
    renderHook(() => useWorkspaceLayoutSync("/ws"));
    await waitFor(() => expect(invokeMock).toHaveBeenCalled());
    expect(useLayout.getState().sidebarHidden["/ws"]).toBeUndefined();
  });

  it("prunes the editor layout to drop tabs whose files are gone", async () => {
    const layout = { root: { type: "pane", id: "p", tabs: [], activeTabId: null } };
    parseEditorLayoutImpl = () => layout;
    collectPathsMock.mockReturnValue(["/ws/a.md", "/ws/b.md"]);
    pruneEditorLayoutMock.mockReturnValue({ pruned: true });
    invokeMock.mockImplementation((cmd: string, args: { path?: string } = {}) => {
      if (cmd === "workspace_layout_load") {
        return Promise.resolve({
          sidebar: { hidden: false },
          editor: { something: true },
        });
      }
      if (cmd === "fs_stat") {
        return args.path === "/ws/a.md"
          ? Promise.resolve({ is_file: true })
          : Promise.reject(new Error("missing"));
      }
      return Promise.resolve(undefined);
    });
    renderHook(() => useWorkspaceLayoutSync("/ws"));
    await waitFor(() => expect(pruneEditorLayoutMock).toHaveBeenCalled());
    const [, missingFn] = pruneEditorLayoutMock.mock.calls[0] ?? [];
    expect((missingFn as (p: string) => boolean)("/ws/a.md")).toBe(false);
    expect((missingFn as (p: string) => boolean)("/ws/b.md")).toBe(true);
    expect(useEditorLayout.getState().layouts["/ws"]).toEqual({ pruned: true });
  });

  it("aborts hydration when the hook unmounts mid-load", async () => {
    let resolveStat: (v: unknown) => void = () => {};
    parseEditorLayoutImpl = () => ({
      root: { type: "pane", id: "p", tabs: [], activeTabId: null },
    });
    collectPathsMock.mockReturnValue(["/ws/a.md"]);
    invokeMock.mockImplementation((cmd: string) => {
      if (cmd === "workspace_layout_load") {
        return Promise.resolve({ sidebar: { hidden: false }, editor: {} });
      }
      if (cmd === "fs_stat") {
        return new Promise((r) => {
          resolveStat = r;
        });
      }
      return Promise.resolve(undefined);
    });
    const { unmount } = renderHook(() => useWorkspaceLayoutSync("/ws"));
    // wait a tick so the async work begins.
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });
    unmount();
    await act(async () => {
      resolveStat({ is_file: true });
      await Promise.resolve();
    });
    expect(useEditorLayout.getState().layouts["/ws"]).toBeUndefined();
  });

  it("tolerates a load failure without throwing", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    invokeMock.mockImplementation((cmd: string) => {
      if (cmd === "workspace_layout_load") return Promise.reject(new Error("no file"));
      return Promise.resolve(undefined);
    });
    renderHook(() => useWorkspaceLayoutSync("/ws"));
    await waitFor(() => expect(warn).toHaveBeenCalled());
    warn.mockRestore();
  });

  it("debounces a save when sidebar state changes after hydration", async () => {
    vi.useFakeTimers();
    invokeMock.mockResolvedValue(undefined);
    renderHook(() => useWorkspaceLayoutSync("/ws"));
    await act(async () => {
      await Promise.resolve();
      vi.advanceTimersByTime(150);
    });
    invokeMock.mockClear();
    act(() => {
      useLayout.getState().setSidebarHidden("/ws", true);
    });
    act(() => {
      vi.advanceTimersByTime(600);
    });
    expect(invokeMock.mock.calls.some((c) => c[0] === "workspace_layout_save")).toBe(true);
  });

  it("includes width and collapsedMode in the saved payload when set", async () => {
    vi.useFakeTimers();
    invokeMock.mockResolvedValue(undefined);
    renderHook(() => useWorkspaceLayoutSync("/ws"));
    await act(async () => {
      await Promise.resolve();
      vi.advanceTimersByTime(150);
    });
    invokeMock.mockClear();
    act(() => {
      useLayout.getState().setSidebarWidth("/ws", 300);
      useLayout.getState().setSidebarCollapsedMode("/ws", "rail");
    });
    act(() => {
      vi.advanceTimersByTime(600);
    });
    const saveCall = invokeMock.mock.calls.find((c) => c[0] === "workspace_layout_save");
    expect(saveCall?.[1].payload.sidebar.width).toBe(300);
    expect(saveCall?.[1].payload.sidebar.collapsedMode).toBe("rail");
  });

  it("includes a serialized editor layout when one exists", async () => {
    vi.useFakeTimers();
    invokeMock.mockResolvedValue(undefined);
    serializeEditorLayoutMock.mockReturnValue({ serialized: true });
    renderHook(() => useWorkspaceLayoutSync("/ws"));
    await act(async () => {
      await Promise.resolve();
      vi.advanceTimersByTime(150);
    });
    invokeMock.mockClear();
    act(() => {
      useEditorLayout.getState().setLayout("/ws", {
        schemaVersion: 1,
        root: { type: "pane", id: "p", tabs: [], activeTabId: null },
        activePaneId: "p",
      });
    });
    act(() => {
      vi.advanceTimersByTime(600);
    });
    const saveCall = invokeMock.mock.calls.find((c) => c[0] === "workspace_layout_save");
    expect(saveCall?.[1].payload.editor).toEqual({ serialized: true });
  });

  it("skips writes when changes arrive within the hydration guard window", async () => {
    vi.useFakeTimers();
    invokeMock.mockResolvedValue(undefined);
    renderHook(() => useWorkspaceLayoutSync("/ws"));
    // Don't advance past the hydration guard - immediately mutate.
    act(() => {
      useLayout.getState().setSidebarHidden("/ws", true);
    });
    act(() => {
      vi.advanceTimersByTime(600);
    });
    // Filter out the workspace_layout_load that runs on mount.
    expect(invokeMock.mock.calls.some((c) => c[0] === "workspace_layout_save")).toBe(false);
  });

  it("warns when a save invoke rejects", async () => {
    vi.useFakeTimers();
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    invokeMock.mockImplementation((cmd: string) =>
      cmd === "workspace_layout_save"
        ? Promise.reject(new Error("disk full"))
        : Promise.resolve(undefined),
    );
    renderHook(() => useWorkspaceLayoutSync("/ws"));
    await act(async () => {
      await Promise.resolve();
      vi.advanceTimersByTime(150);
    });
    act(() => {
      useLayout.getState().setSidebarHidden("/ws", true);
    });
    act(() => {
      vi.advanceTimersByTime(600);
    });
    // Wait for the rejection to surface.
    vi.useRealTimers();
    await waitFor(() =>
      expect(warn).toHaveBeenCalledWith("[layout-sync] save failed", expect.any(Error)),
    );
    warn.mockRestore();
  });

  it("saves when the editor-layout store mutates", async () => {
    vi.useFakeTimers();
    invokeMock.mockResolvedValue(undefined);
    renderHook(() => useWorkspaceLayoutSync("/ws"));
    await act(async () => {
      await Promise.resolve();
      vi.advanceTimersByTime(150);
    });
    invokeMock.mockClear();
    act(() => {
      useEditorLayout.getState().setLayout("/ws", {
        schemaVersion: 1,
        root: { type: "pane", id: "p", tabs: [], activeTabId: null },
        activePaneId: "p",
      });
    });
    act(() => {
      vi.advanceTimersByTime(600);
    });
    expect(invokeMock.mock.calls.some((c) => c[0] === "workspace_layout_save")).toBe(true);
  });

  it("ignores editor-layout mutations for other workspaces", async () => {
    vi.useFakeTimers();
    invokeMock.mockResolvedValue(undefined);
    renderHook(() => useWorkspaceLayoutSync("/ws"));
    await act(async () => {
      await Promise.resolve();
      vi.advanceTimersByTime(150);
    });
    invokeMock.mockClear();
    act(() => {
      useEditorLayout.getState().setLayout("/other", {
        schemaVersion: 1,
        root: { type: "pane", id: "p", tabs: [], activeTabId: null },
        activePaneId: "p",
      });
    });
    act(() => {
      vi.advanceTimersByTime(600);
    });
    expect(invokeMock.mock.calls.some((c) => c[0] === "workspace_layout_save")).toBe(false);
  });

  it("warns when an editor-layout-driven save invoke rejects", async () => {
    vi.useFakeTimers();
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    invokeMock.mockImplementation((cmd: string) =>
      cmd === "workspace_layout_save"
        ? Promise.reject(new Error("disk full"))
        : Promise.resolve(undefined),
    );
    renderHook(() => useWorkspaceLayoutSync("/ws"));
    await act(async () => {
      await Promise.resolve();
      vi.advanceTimersByTime(150);
    });
    act(() => {
      useEditorLayout.getState().setLayout("/ws", {
        schemaVersion: 1,
        root: { type: "pane", id: "p", tabs: [], activeTabId: null },
        activePaneId: "p",
      });
    });
    act(() => {
      vi.advanceTimersByTime(600);
    });
    vi.useRealTimers();
    await waitFor(() =>
      expect(warn).toHaveBeenCalledWith("[layout-sync] save failed", expect.any(Error)),
    );
    warn.mockRestore();
  });

  it("cancels a pending save on unmount", async () => {
    vi.useFakeTimers();
    invokeMock.mockResolvedValue(undefined);
    const { unmount } = renderHook(() => useWorkspaceLayoutSync("/ws"));
    await act(async () => {
      await Promise.resolve();
      vi.advanceTimersByTime(150);
    });
    invokeMock.mockClear();
    act(() => {
      useLayout.getState().setSidebarHidden("/ws", true);
    });
    unmount();
    act(() => {
      vi.advanceTimersByTime(600);
    });
    expect(invokeMock.mock.calls.some((c) => c[0] === "workspace_layout_save")).toBe(false);
  });

  it("debounces two rapid editor-layout mutations into a single save", async () => {
    vi.useFakeTimers();
    invokeMock.mockResolvedValue(undefined);
    renderHook(() => useWorkspaceLayoutSync("/ws"));
    await act(async () => {
      await Promise.resolve();
      vi.advanceTimersByTime(150);
    });
    invokeMock.mockClear();
    act(() => {
      useEditorLayout.getState().setLayout("/ws", {
        schemaVersion: 1,
        root: { type: "pane", id: "p", tabs: [], activeTabId: null },
        activePaneId: "p",
      });
    });
    act(() => {
      vi.advanceTimersByTime(200);
    });
    act(() => {
      useEditorLayout.getState().setLayout("/ws", {
        schemaVersion: 1,
        root: { type: "pane", id: "p2", tabs: [], activeTabId: null },
        activePaneId: "p2",
      });
    });
    act(() => {
      vi.advanceTimersByTime(600);
    });
    expect(invokeMock.mock.calls.filter((c) => c[0] === "workspace_layout_save").length).toBe(1);
  });

  it("includes sidebar width and collapsedMode in an editor-layout save", async () => {
    vi.useFakeTimers();
    invokeMock.mockResolvedValue(undefined);
    renderHook(() => useWorkspaceLayoutSync("/ws"));
    await act(async () => {
      await Promise.resolve();
      vi.advanceTimersByTime(150);
    });
    // Pre-set sidebar width and collapsed mode so the editor save picks them up.
    act(() => {
      useLayout.getState().setSidebarWidth("/ws", 320);
      useLayout.getState().setSidebarCollapsedMode("/ws", "rail");
      vi.advanceTimersByTime(600);
    });
    invokeMock.mockClear();
    act(() => {
      useEditorLayout.getState().setLayout("/ws", {
        schemaVersion: 1,
        root: { type: "pane", id: "p", tabs: [], activeTabId: null },
        activePaneId: "p",
      });
    });
    act(() => {
      vi.advanceTimersByTime(600);
    });
    const saveCall = invokeMock.mock.calls.find((c) => c[0] === "workspace_layout_save");
    expect(saveCall?.[1].payload.sidebar.width).toBe(320);
    expect(saveCall?.[1].payload.sidebar.collapsedMode).toBe("rail");
  });

  it("debounces two rapid changes into a single save", async () => {
    vi.useFakeTimers();
    invokeMock.mockResolvedValue(undefined);
    renderHook(() => useWorkspaceLayoutSync("/ws"));
    await act(async () => {
      await Promise.resolve();
      vi.advanceTimersByTime(150);
    });
    invokeMock.mockClear();
    act(() => {
      useLayout.getState().setSidebarHidden("/ws", true);
    });
    act(() => {
      vi.advanceTimersByTime(200);
    });
    act(() => {
      useLayout.getState().setSidebarHidden("/ws", false);
    });
    act(() => {
      vi.advanceTimersByTime(600);
    });
    const saves = invokeMock.mock.calls.filter((c) => c[0] === "workspace_layout_save");
    expect(saves.length).toBe(1);
  });
});
