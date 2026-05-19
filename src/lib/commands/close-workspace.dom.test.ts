// S-TST: close-workspace command — dirty-tab handling, autosave vs ask.

import { beforeEach, describe, expect, it, vi } from "vitest";

const ask = vi.fn();
vi.mock("@tauri-apps/plugin-dialog", () => ({
  ask: (...a: unknown[]) => ask(...a),
}));

import { useSettings } from "../../store/settings";
import { useTabs } from "../../store/tabs";
import type { OpenTab } from "../../store/tabs";
import { useToasts } from "../../store/toasts";
import { useWorkspace } from "../../store/workspace";
import { closeWorkspaceCommand } from "./close-workspace";

const POS = { line: 0, column: 0, scrollTop: 0 };

function tab(path: string, dirty: boolean): OpenTab {
  return { path, position: POS, dirty };
}

beforeEach(() => {
  ask.mockReset();
  useWorkspace.setState({ current: null, readOnly: false });
  useTabs.setState({ tabs: [], activePath: null });
  useToasts.setState({ toasts: [] });
  useSettings.setState({ autosaveOnClose: true });
});

describe("closeWorkspaceCommand", () => {
  it("returns true immediately when no workspace is open", async () => {
    expect(await closeWorkspaceCommand()).toBe(true);
  });

  it("closes immediately when no tabs are dirty", async () => {
    useWorkspace.setState({ current: "/ws", readOnly: false });
    useTabs.setState({ tabs: [tab("/a.md", false)], activePath: "/a.md" });
    expect(await closeWorkspaceCommand()).toBe(true);
    expect(useWorkspace.getState().current).toBeNull();
    expect(useTabs.getState().tabs).toEqual([]);
    expect(ask).not.toHaveBeenCalled();
  });

  it("autosaves dirty tabs and closes when autosaveOnClose is on", async () => {
    useWorkspace.setState({ current: "/ws", readOnly: false });
    useTabs.setState({ tabs: [tab("/a.md", true)], activePath: "/a.md" });
    useSettings.setState({ autosaveOnClose: true });
    const listener = vi.fn();
    window.addEventListener("markspread:save-all-then-close", listener);
    expect(await closeWorkspaceCommand()).toBe(true);
    window.removeEventListener("markspread:save-all-then-close", listener);
    expect(listener).toHaveBeenCalledTimes(1);
    expect(useToasts.getState().toasts[0]?.message).toBe("workspace.close.autosaved");
    expect(useWorkspace.getState().current).toBeNull();
  });

  it("asks for confirmation when autosave is off and the user confirms", async () => {
    useWorkspace.setState({ current: "/ws", readOnly: false });
    useTabs.setState({ tabs: [tab("/a.md", true)], activePath: "/a.md" });
    useSettings.setState({ autosaveOnClose: false });
    ask.mockResolvedValueOnce(true);
    expect(await closeWorkspaceCommand()).toBe(true);
    expect(useWorkspace.getState().current).toBeNull();
  });

  it("aborts the close when the user declines the confirm dialog", async () => {
    useWorkspace.setState({ current: "/ws", readOnly: false });
    useTabs.setState({ tabs: [tab("/a.md", true)], activePath: "/a.md" });
    useSettings.setState({ autosaveOnClose: false });
    ask.mockResolvedValueOnce(false);
    expect(await closeWorkspaceCommand()).toBe(false);
    expect(useWorkspace.getState().current).toBe("/ws");
  });
});
