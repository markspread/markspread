// MAR-1015: palette wiring for workspace-shell commands.

import { beforeEach, describe, expect, it, vi } from "vitest";
import { clearPaletteItems, query } from "./registry";
import {
  type WorkspaceCommandsDeps,
  __workspaceCommandSpecs,
  registerWorkspacePaletteCommands,
} from "./workspace-commands";

function makeDeps(overrides: Partial<WorkspaceCommandsDeps> = {}): WorkspaceCommandsDeps {
  return {
    getLayout: () => ({ activeTabId: "t1", root: { type: "ws-tabs" } }),
    addWorkspaceTab: vi.fn(),
    closeWorkspaceTab: vi.fn(() => true),
    splitVertical: vi.fn(),
    splitHorizontal: vi.fn(),
    setActiveTab: vi.fn(),
    getActiveWorkspacePath: () => "/ws",
    getActiveTabsList: () => [{ id: "t1" }, { id: "t2" }, { id: "t3" }],
    getPreferredShell: () => "editor",
    focusSplitInDirection: vi.fn(() => true),
    ...overrides,
  };
}

beforeEach(() => {
  clearPaletteItems();
});

describe("registerWorkspacePaletteCommands", () => {
  it("registers every workspace command into the palette", () => {
    registerWorkspacePaletteCommands(makeDeps());
    const results = query({ raw: "workspace", limit: 50 });
    const ids = new Set(results.map((r) => r.id));
    expect(ids.has("workspace.new_tab")).toBe(true);
    expect(ids.has("workspace.close_tab")).toBe(true);
    expect(ids.has("workspace.split_vertical")).toBe(true);
    expect(ids.has("workspace.split_horizontal")).toBe(true);
    expect(ids.has("workspace.focus_split_up")).toBe(true);
    expect(ids.has("workspace.focus_split_down")).toBe(true);
    expect(ids.has("workspace.focus_split_left")).toBe(true);
    expect(ids.has("workspace.focus_split_right")).toBe(true);
    for (let i = 1; i <= 9; i += 1) {
      expect(ids.has(`workspace.tab_${i}`)).toBe(true);
    }
  });

  it("renders a bound shortcut on every entry", () => {
    registerWorkspacePaletteCommands(makeDeps());
    const results = query({ raw: "workspace", limit: 50 });
    for (const item of results) {
      expect(item.shortcut).toBeTruthy();
    }
  });

  it("Workspace: New Tab calls addWorkspaceTab with the active path", () => {
    const deps = makeDeps();
    registerWorkspacePaletteCommands(deps);
    const item = query({ raw: "workspace new tab", limit: 50 }).find(
      (i) => i.id === "workspace.new_tab",
    );
    expect(item).toBeTruthy();
    item?.run();
    expect(deps.addWorkspaceTab).toHaveBeenCalledWith("/ws");
  });

  it("Workspace: New Tab is a noop when no active path is available", () => {
    const deps = makeDeps({ getActiveWorkspacePath: () => null });
    registerWorkspacePaletteCommands(deps);
    const item = query({ raw: "workspace new tab", limit: 50 }).find(
      (i) => i.id === "workspace.new_tab",
    );
    item?.run();
    expect(deps.addWorkspaceTab).not.toHaveBeenCalled();
  });

  it("Workspace: Close Tab calls closeWorkspaceTab(activeTabId)", () => {
    const deps = makeDeps();
    registerWorkspacePaletteCommands(deps);
    const item = query({ raw: "workspace close tab", limit: 50 }).find(
      (i) => i.id === "workspace.close_tab",
    );
    item?.run();
    expect(deps.closeWorkspaceTab).toHaveBeenCalledWith("t1");
  });

  it("Workspace: Close Tab bails when there is no layout", () => {
    const deps = makeDeps({ getLayout: () => null });
    registerWorkspacePaletteCommands(deps);
    const item = query({ raw: "workspace close tab", limit: 50 }).find(
      (i) => i.id === "workspace.close_tab",
    );
    item?.run();
    expect(deps.closeWorkspaceTab).not.toHaveBeenCalled();
  });

  it("Workspace: Split Vertical / Horizontal route to the store", () => {
    const deps = makeDeps();
    registerWorkspacePaletteCommands(deps);
    const results = query({ raw: "workspace split", limit: 50 });
    const vertical = results.find((i) => i.id === "workspace.split_vertical");
    const horizontal = results.find((i) => i.id === "workspace.split_horizontal");
    vertical?.run();
    horizontal?.run();
    expect(deps.splitVertical).toHaveBeenCalledOnce();
    expect(deps.splitHorizontal).toHaveBeenCalledOnce();
  });

  it("Workspace: Focus Split (Up/Down/Left/Right) call focusSplitInDirection", () => {
    const deps = makeDeps();
    registerWorkspacePaletteCommands(deps);
    for (const dir of ["up", "down", "left", "right"] as const) {
      const id = `workspace.focus_split_${dir}`;
      const item = query({ raw: "workspace focus split", limit: 50 }).find((i) => i.id === id);
      item?.run();
    }
    const calls = (deps.focusSplitInDirection as ReturnType<typeof vi.fn>).mock.calls.map(
      (c) => c[0],
    );
    expect(calls).toEqual(["up", "down", "left", "right"]);
  });

  it("Workspace: Switch to Tab N routes to the Nth tab id", () => {
    const deps = makeDeps();
    registerWorkspacePaletteCommands(deps);
    const item = query({ raw: "workspace tab 3", limit: 50 }).find(
      (i) => i.id === "workspace.tab_3",
    );
    item?.run();
    expect(deps.setActiveTab).toHaveBeenCalledWith("t3");
  });

  it("Workspace: Switch to Tab N is a noop when the index is out of range", () => {
    const deps = makeDeps({ getActiveTabsList: () => [{ id: "only" }] });
    registerWorkspacePaletteCommands(deps);
    const item = query({ raw: "workspace tab 9", limit: 50 }).find(
      (i) => i.id === "workspace.tab_9",
    );
    item?.run();
    expect(deps.setActiveTab).not.toHaveBeenCalled();
  });

  it("does NOT run the handler when the chat shell is active", () => {
    const deps = makeDeps({ getPreferredShell: () => "chat" });
    registerWorkspacePaletteCommands(deps);
    const item = query({ raw: "workspace new tab", limit: 50 }).find(
      (i) => i.id === "workspace.new_tab",
    );
    item?.run();
    expect(deps.addWorkspaceTab).not.toHaveBeenCalled();
  });

  it("still runs the handler when no shell preference is set", () => {
    const deps = makeDeps({ getPreferredShell: () => null });
    registerWorkspacePaletteCommands(deps);
    const item = query({ raw: "workspace new tab", limit: 50 }).find(
      (i) => i.id === "workspace.new_tab",
    );
    item?.run();
    expect(deps.addWorkspaceTab).toHaveBeenCalled();
  });

  it("detaches every registration", () => {
    const detach = registerWorkspacePaletteCommands(makeDeps());
    expect(query({ raw: "workspace", limit: 50 }).length).toBeGreaterThan(0);
    detach();
    const remaining = query({ raw: "workspace", limit: 50 }).filter((i) =>
      i.id.startsWith("workspace."),
    );
    expect(remaining).toEqual([]);
  });

  it("covers every spec at least once via the SPECS export", () => {
    // Smoke test: exercise the run handler from each spec — guards against
    // forgetting to wire one into the deps interface.
    const deps = makeDeps();
    for (const spec of __workspaceCommandSpecs) {
      spec.run(deps);
    }
    expect(__workspaceCommandSpecs.length).toBe(17);
  });
});
