// S-TST: switch-workspace command — session snapshot/restore, dirty-tab
// handling, and scaffold failure.

import { beforeEach, describe, expect, it, vi } from "vitest";

const invoke = vi.fn();
const ask = vi.fn();
vi.mock("@tauri-apps/api/core", () => ({
  invoke: (...a: unknown[]) => invoke(...a),
}));
vi.mock("@tauri-apps/plugin-dialog", () => ({
  ask: (...a: unknown[]) => ask(...a),
}));

import { useRecentWorkspaces } from "../../store/recent-workspaces";
import { useSettings } from "../../store/settings";
import { useTabs } from "../../store/tabs";
import type { OpenTab } from "../../store/tabs";
import { useToasts } from "../../store/toasts";
import { useWorkspace } from "../../store/workspace";
import { useWorkspaceSessions } from "../../store/workspace-sessions";
import { switchWorkspaceCommand } from "./switch-workspace";

const POS = { line: 0, column: 0, scrollTop: 0 };

function tab(path: string, dirty?: boolean): OpenTab {
  return dirty === undefined ? { path, position: POS } : { path, position: POS, dirty };
}

beforeEach(() => {
  invoke.mockReset();
  ask.mockReset();
  useWorkspace.setState({ current: null, readOnly: false });
  useTabs.setState({ tabs: [], activePath: null });
  useToasts.setState({ toasts: [] });
  useRecentWorkspaces.setState({ recent: [] });
  useWorkspaceSessions.setState({ sessions: {} });
  useSettings.setState({ autosaveOnClose: true });
});

describe("switchWorkspaceCommand", () => {
  it("returns true when the target is already the current workspace", async () => {
    useWorkspace.setState({ current: "/ws", readOnly: false });
    expect(await switchWorkspaceCommand("/ws")).toBe(true);
    expect(invoke).not.toHaveBeenCalled();
  });

  it("scaffolds the target and opens it with no prior session", async () => {
    useWorkspace.setState({ current: "/old", readOnly: false });
    invoke.mockResolvedValueOnce({ root: "/new" });
    expect(await switchWorkspaceCommand("/new")).toBe(true);
    expect(useWorkspace.getState().current).toBe("/new");
    expect(useTabs.getState().tabs).toEqual([]);
    expect(useRecentWorkspaces.getState().recent.map((r) => r.path)).toContain("/new");
  });

  it("snapshots the current session and restores the target session", async () => {
    useWorkspace.setState({ current: "/old", readOnly: false });
    useTabs.setState({ tabs: [tab("/old/a.md")], activePath: "/old/a.md" });
    useWorkspaceSessions.setState({
      sessions: { "/new": { tabs: [tab("/new/b.md")], activePath: "/new/b.md" } },
    });
    invoke.mockResolvedValueOnce({ root: "/new" });
    expect(await switchWorkspaceCommand("/new")).toBe(true);
    expect(useTabs.getState().activePath).toBe("/new/b.md");
    const saved = useWorkspaceSessions.getState().sessions["/old"];
    expect(saved?.activePath).toBe("/old/a.md");
  });

  it("autosaves dirty tabs when autosaveOnClose is on", async () => {
    useWorkspace.setState({ current: "/old", readOnly: false });
    useTabs.setState({ tabs: [tab("/old/a.md", true)], activePath: "/old/a.md" });
    useSettings.setState({ autosaveOnClose: true });
    invoke.mockResolvedValueOnce({ root: "/new" });
    const listener = vi.fn();
    window.addEventListener("markspread:save-all-then-close", listener);
    expect(await switchWorkspaceCommand("/new")).toBe(true);
    window.removeEventListener("markspread:save-all-then-close", listener);
    expect(listener).toHaveBeenCalledTimes(1);
  });

  it("aborts when the user declines the dirty-tab confirm dialog", async () => {
    useWorkspace.setState({ current: "/old", readOnly: false });
    useTabs.setState({ tabs: [tab("/old/a.md", true)], activePath: "/old/a.md" });
    useSettings.setState({ autosaveOnClose: false });
    ask.mockResolvedValueOnce(false);
    expect(await switchWorkspaceCommand("/new")).toBe(false);
    expect(useWorkspace.getState().current).toBe("/old");
  });

  it("proceeds when the user confirms the dirty-tab dialog", async () => {
    useWorkspace.setState({ current: "/old", readOnly: false });
    useTabs.setState({ tabs: [tab("/old/a.md", true)], activePath: "/old/a.md" });
    useSettings.setState({ autosaveOnClose: false });
    ask.mockResolvedValueOnce(true);
    invoke.mockResolvedValueOnce({ root: "/new" });
    expect(await switchWorkspaceCommand("/new")).toBe(true);
  });

  it("toasts and leaves the current workspace intact when scaffold fails", async () => {
    useWorkspace.setState({ current: "/old", readOnly: false });
    invoke.mockRejectedValueOnce(new Error("scaffold failed"));
    expect(await switchWorkspaceCommand("/new")).toBe(false);
    expect(useWorkspace.getState().current).toBe("/old");
    expect(useToasts.getState().toasts[0]?.message).toBe("workspace.switch.failed");
  });
});
