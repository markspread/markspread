// session restore — CLI override, workspace stat, tab reconciliation.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useEditorLayout } from "../store/editor-layout";
import { useSingleFile } from "../store/single-file";
import { useTabs } from "../store/tabs";
import { useToasts } from "../store/toasts";
import { useWorkspace } from "../store/workspace";

const invokeMock = vi.fn();
const routeMock = vi.fn();
vi.mock("@tauri-apps/api/core", () => ({
  invoke: (...args: unknown[]) => invokeMock(...args),
}));
vi.mock("./cli-route", () => ({
  routeCliPathArg: (...args: unknown[]) => routeMock(...args),
}));

const FLAGS = { no_restore: false, headless_cold_start: false, path_arg: null };

function tab(path: string, modifiedMs?: number) {
  return {
    path,
    position: { line: 0, column: 0, scrollTop: 0 },
    ...(modifiedMs !== undefined && { modifiedMs }),
  };
}

beforeEach(() => {
  invokeMock.mockReset();
  routeMock.mockReset();
  useWorkspace.setState({ current: null });
  useTabs.setState({ tabs: [], activePath: null });
  useSingleFile.setState({ path: null, content: "" });
  useToasts.setState({ toasts: [] });
  useEditorLayout.setState({ layouts: {} });
});

afterEach(() => {
  invokeMock.mockReset();
  routeMock.mockReset();
});

describe("restoreSessionOrFallback", () => {
  it("routes a CLI path argument and skips restore", async () => {
    invokeMock.mockResolvedValueOnce({ ...FLAGS, path_arg: "/cli/path" });
    const { restoreSessionOrFallback } = await import("./session");
    await restoreSessionOrFallback();
    expect(routeMock).toHaveBeenCalledWith("/cli/path");
  });

  it("returns early when there is no persisted workspace", async () => {
    invokeMock.mockResolvedValueOnce(FLAGS);
    const { restoreSessionOrFallback } = await import("./session");
    await restoreSessionOrFallback();
    expect(useWorkspace.getState().current).toBeNull();
  });

  it("clears everything when no_restore is set", async () => {
    invokeMock.mockResolvedValueOnce({ ...FLAGS, no_restore: true });
    useWorkspace.setState({ current: "/ws" });
    useTabs.setState({ tabs: [tab("/ws/a.md")], activePath: "/ws/a.md" });
    const { restoreSessionOrFallback } = await import("./session");
    await restoreSessionOrFallback();
    expect(useWorkspace.getState().current).toBeNull();
    expect(useTabs.getState().tabs).toHaveLength(0);
  });

  it("closes the workspace when the persisted root is not a directory", async () => {
    invokeMock.mockResolvedValueOnce(FLAGS).mockResolvedValueOnce({ kind: "file" });
    useWorkspace.setState({ current: "/ws" });
    const { restoreSessionOrFallback } = await import("./session");
    await restoreSessionOrFallback();
    expect(useWorkspace.getState().current).toBeNull();
  });

  it("closes the workspace when the root stat rejects", async () => {
    invokeMock.mockResolvedValueOnce(FLAGS).mockRejectedValueOnce(new Error("gone"));
    useWorkspace.setState({ current: "/ws" });
    const { restoreSessionOrFallback } = await import("./session");
    await restoreSessionOrFallback();
    expect(useWorkspace.getState().current).toBeNull();
  });

  it("reconciles surviving tabs and drops missing ones", async () => {
    invokeMock
      .mockResolvedValueOnce(FLAGS)
      .mockResolvedValueOnce({ kind: "dir" }) // root stat
      .mockResolvedValueOnce({ kind: "file", modified_ms: 100 }) // a.md survives
      .mockRejectedValueOnce(new Error("missing")) // b.md dropped
      .mockResolvedValueOnce({ kind: "dir" }); // c.md became a dir → dropped
    useWorkspace.setState({ current: "/ws" });
    useTabs.setState({
      tabs: [tab("/ws/a.md"), tab("/ws/b.md"), tab("/ws/c.md")],
      activePath: "/ws/a.md",
    });
    const { restoreSessionOrFallback } = await import("./session");
    await restoreSessionOrFallback();
    const tabs = useTabs.getState().tabs;
    expect(tabs.map((t) => t.path)).toEqual(["/ws/a.md"]);
    const dropped = useToasts.getState().toasts.filter((t) => t.message === "session.tab.missing");
    expect(dropped).toHaveLength(2);
  });

  it("flags externally changed tabs", async () => {
    invokeMock
      .mockResolvedValueOnce(FLAGS)
      .mockResolvedValueOnce({ kind: "dir" })
      .mockResolvedValueOnce({ kind: "file", modified_ms: 5000 });
    useWorkspace.setState({ current: "/ws" });
    useTabs.setState({
      tabs: [tab("/ws/a.md", 1000)],
      activePath: "/ws/a.md",
    });
    const { restoreSessionOrFallback } = await import("./session");
    await restoreSessionOrFallback();
    const changed = useToasts
      .getState()
      .toasts.find((t) => t.message === "session.tab.externally_changed");
    expect(changed).toBeDefined();
  });

  it("seeds the editor layout from legacy tabs", async () => {
    invokeMock
      .mockResolvedValueOnce(FLAGS)
      .mockResolvedValueOnce({ kind: "dir" })
      .mockResolvedValueOnce({ kind: "file", modified_ms: 1 });
    useWorkspace.setState({ current: "/ws" });
    useTabs.setState({ tabs: [tab("/ws/a.md")], activePath: "/ws/a.md" });
    const { restoreSessionOrFallback } = await import("./session");
    await restoreSessionOrFallback();
    expect(useEditorLayout.getState().layouts["/ws"]).toBeDefined();
  });

  it("falls back to default flags when cli_flags rejects", async () => {
    invokeMock.mockRejectedValueOnce(new Error("no runtime"));
    const { restoreSessionOrFallback } = await import("./session");
    await restoreSessionOrFallback();
    expect(routeMock).not.toHaveBeenCalled();
  });
});
