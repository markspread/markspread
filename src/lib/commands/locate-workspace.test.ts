// S-TST: locate-workspace command — pick a moved workspace root and
// splice Recent + active state.

import { beforeEach, describe, expect, it, vi } from "vitest";

const invoke = vi.fn();
const openDialog = vi.fn();
vi.mock("@tauri-apps/api/core", () => ({
  invoke: (...a: unknown[]) => invoke(...a),
}));
vi.mock("@tauri-apps/plugin-dialog", () => ({
  open: (...a: unknown[]) => openDialog(...a),
}));

import { useRecentWorkspaces } from "../../store/recent-workspaces";
import { useToasts } from "../../store/toasts";
import { useWorkspace } from "../../store/workspace";
import { locateWorkspaceCommand } from "./locate-workspace";

beforeEach(() => {
  invoke.mockReset();
  openDialog.mockReset();
  useToasts.setState({ toasts: [] });
  useRecentWorkspaces.setState({ recent: [] });
  useWorkspace.setState({ current: null, readOnly: false });
});

describe("locateWorkspaceCommand", () => {
  it("returns false when the user cancels the picker", async () => {
    openDialog.mockResolvedValueOnce(null);
    expect(await locateWorkspaceCommand("/old")).toBe(false);
  });

  it("returns false on an empty selection", async () => {
    openDialog.mockResolvedValueOnce("");
    expect(await locateWorkspaceCommand("/old")).toBe(false);
  });

  it("toasts and returns false when inspection fails", async () => {
    openDialog.mockResolvedValueOnce("/new/path");
    invoke.mockRejectedValueOnce(new Error("io error"));
    expect(await locateWorkspaceCommand("/old")).toBe(false);
    const toasts = useToasts.getState().toasts;
    expect(toasts[0]?.kind).toBe("error");
    expect(toasts[0]?.message).toBe("workspace.locate.failed");
  });

  it("warns and returns false when the folder is not a workspace", async () => {
    openDialog.mockResolvedValueOnce("/new/path");
    invoke.mockResolvedValueOnce({ root: "/new/path", already_existed: false });
    expect(await locateWorkspaceCommand("/old")).toBe(false);
    expect(useToasts.getState().toasts[0]?.message).toBe("workspace.locate.not_a_workspace");
  });

  it("relocates the workspace and updates Recent on success", async () => {
    useRecentWorkspaces.setState({ recent: [{ path: "/old", lastOpenedMs: 1 }] });
    openDialog.mockResolvedValueOnce("/new/path");
    invoke.mockResolvedValueOnce({ root: "/new/root", already_existed: true });
    expect(await locateWorkspaceCommand("/old")).toBe(true);
    expect(useWorkspace.getState().current).toBe("/new/root");
    const recentPaths = useRecentWorkspaces.getState().recent.map((r) => r.path);
    expect(recentPaths).toContain("/new/root");
    expect(recentPaths).not.toContain("/old");
    expect(useToasts.getState().toasts[0]?.message).toBe("workspace.locate.updated");
  });
});
