import { renderHook, waitFor } from "@testing-library/react";
import { act } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const invokeMock = vi.fn();
vi.mock("@tauri-apps/api/core", () => ({
  invoke: (cmd: string, args: unknown) => invokeMock(cmd, args),
}));
vi.mock("../lib/editor/layout-model", () => ({
  collectPaths: () => [],
  parseEditorLayout: () => null,
  pruneEditorLayout: (l: unknown) => l,
  serializeEditorLayout: (l: unknown) => l,
}));

import { useLayout } from "../store/layout";
import { useWorkspaceLayoutSync } from "./useWorkspaceLayoutSync";

describe("useWorkspaceLayoutSync", () => {
  beforeEach(() => {
    invokeMock.mockReset();
    invokeMock.mockResolvedValue(undefined);
    useLayout.setState({ sidebarHidden: {}, sidebarWidth: {}, sidebarCollapsedMode: {} });
  });
  afterEach(() => {
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
    // flush the load microtask + release the hydration guard.
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
});
