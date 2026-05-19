// S-WS-006/021/022: workspace open / new flows + error presentation.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useRecentWorkspaces } from "../store/recent-workspaces";
import { useToasts } from "../store/toasts";
import { useWorkspace } from "../store/workspace";

const invokeMock = vi.fn();
const askMock = vi.fn();
const messageMock = vi.fn();
const openDialogMock = vi.fn();
vi.mock("@tauri-apps/api/core", () => ({
  invoke: (...args: unknown[]) => invokeMock(...args),
}));
vi.mock("@tauri-apps/plugin-dialog", () => ({
  ask: (...args: unknown[]) => askMock(...args),
  message: (...args: unknown[]) => messageMock(...args),
  open: (...args: unknown[]) => openDialogMock(...args),
}));

const baseLayout = {
  root: "/ws",
  meta_dir: "/ws/.markspread",
  settings: "/ws/.markspread/settings.json",
  index_db: "/ws/.markspread/index.db",
  snapshots: "/ws/.markspread/snapshots",
  already_existed: true,
  settings_schema_version: 1,
  current_schema_version: 2,
  index_db_corrupt: false,
  read_only: false,
};

beforeEach(() => {
  invokeMock.mockReset();
  askMock.mockReset();
  messageMock.mockReset();
  openDialogMock.mockReset();
  useWorkspace.setState({ current: null });
  useToasts.setState({ toasts: [] });
  useRecentWorkspaces.setState({ recent: [] });
});

afterEach(() => {});

describe("openWorkspaceFromDialog", () => {
  it("returns null when the dialog is cancelled", async () => {
    openDialogMock.mockResolvedValueOnce(null);
    const { openWorkspaceFromDialog } = await import("./open-workspace");
    expect(await openWorkspaceFromDialog()).toBeNull();
  });

  it("opens an existing workspace happy path", async () => {
    openDialogMock.mockResolvedValueOnce("/ws");
    invokeMock
      // workspace_inspect
      .mockResolvedValueOnce({
        root: "/ws",
        already_existed: true,
        settings_schema_version: 1,
        current_schema_version: 2,
        index_db_corrupt: false,
        read_only: false,
      })
      // workspace_scaffold
      .mockResolvedValueOnce(baseLayout)
      // workspace_settings_check
      .mockResolvedValueOnce(true)
      // drive_classify
      .mockResolvedValueOnce({ kind: "internal", case_preserving_only: false });
    const { openWorkspaceFromDialog } = await import("./open-workspace");
    const root = await openWorkspaceFromDialog();
    expect(root).toBe("/ws");
    expect(useWorkspace.getState().current).toBe("/ws");
    expect(useRecentWorkspaces.getState().recent[0]?.path).toBe("/ws");
  });

  it("presents a permission error via a message dialog", async () => {
    openDialogMock.mockResolvedValueOnce("/ws");
    invokeMock.mockRejectedValueOnce({ code: "EACCES", message: "denied" });
    const { openWorkspaceFromDialog } = await import("./open-workspace");
    expect(await openWorkspaceFromDialog()).toBeNull();
    expect(messageMock).toHaveBeenCalledWith(
      "denied",
      expect.objectContaining({ kind: "warning" }),
    );
  });

  it("presents a disk-space error via a message dialog", async () => {
    openDialogMock.mockResolvedValueOnce("/ws");
    invokeMock.mockRejectedValueOnce({ code: "ENOSPC", message: "full" });
    const { openWorkspaceFromDialog } = await import("./open-workspace");
    await openWorkspaceFromDialog();
    expect(messageMock).toHaveBeenCalledWith("full", expect.objectContaining({ kind: "error" }));
  });

  it("toasts a generic app error", async () => {
    openDialogMock.mockResolvedValueOnce("/ws");
    invokeMock.mockRejectedValueOnce({ code: "EOTHER", message: "weird" });
    const { openWorkspaceFromDialog } = await import("./open-workspace");
    await openWorkspaceFromDialog();
    expect(useToasts.getState().toasts[0]?.message).toBe("weird");
  });

  it("toasts a non-AppError rejection as a string", async () => {
    openDialogMock.mockResolvedValueOnce("/ws");
    invokeMock.mockRejectedValueOnce("plain failure");
    const { openWorkspaceFromDialog } = await import("./open-workspace");
    await openWorkspaceFromDialog();
    expect(useToasts.getState().toasts[0]?.message).toContain("plain failure");
  });

  it("prompts to initialise a folder without an existing workspace", async () => {
    openDialogMock.mockResolvedValueOnce("/ws");
    invokeMock.mockResolvedValueOnce({
      root: "/ws",
      already_existed: false,
      settings_schema_version: null,
      current_schema_version: 2,
      index_db_corrupt: false,
      read_only: false,
    });
    askMock.mockResolvedValueOnce(false);
    const { openWorkspaceFromDialog } = await import("./open-workspace");
    expect(await openWorkspaceFromDialog()).toBeNull();
  });

  it("rejects a settings schema newer than the app supports", async () => {
    openDialogMock.mockResolvedValueOnce("/ws");
    invokeMock
      .mockResolvedValueOnce({
        root: "/ws",
        already_existed: true,
        settings_schema_version: 1,
        current_schema_version: 2,
        index_db_corrupt: false,
        read_only: false,
      })
      .mockResolvedValueOnce({ ...baseLayout, settings_schema_version: 99 })
      .mockResolvedValueOnce(true);
    const { openWorkspaceFromDialog } = await import("./open-workspace");
    await openWorkspaceFromDialog();
    expect(useToasts.getState().toasts[0]?.message).toBe("workspace.error.schema_too_new");
    expect(useWorkspace.getState().current).toBeNull();
  });

  it("quarantines a corrupt index db and notifies", async () => {
    openDialogMock.mockResolvedValueOnce("/ws");
    invokeMock
      .mockResolvedValueOnce({
        root: "/ws",
        already_existed: true,
        settings_schema_version: 1,
        current_schema_version: 2,
        index_db_corrupt: true,
        read_only: false,
      })
      .mockResolvedValueOnce({ ...baseLayout, index_db_corrupt: true })
      .mockResolvedValueOnce(true) // settings_check
      .mockResolvedValueOnce("/ws/.markspread/index.db.broken") // quarantine
      .mockResolvedValueOnce(undefined) // fs_index_rebuild
      .mockResolvedValueOnce({ kind: "internal", case_preserving_only: false });
    const { openWorkspaceFromDialog } = await import("./open-workspace");
    await openWorkspaceFromDialog();
    const msgs = useToasts.getState().toasts.map((t) => t.message);
    expect(msgs).toContain("workspace.warn.index_corrupt");
  });

  it("recovers a corrupt settings file when the user confirms", async () => {
    openDialogMock.mockResolvedValueOnce("/ws");
    invokeMock
      .mockResolvedValueOnce({
        root: "/ws",
        already_existed: true,
        settings_schema_version: 1,
        current_schema_version: 2,
        index_db_corrupt: false,
        read_only: false,
      })
      .mockResolvedValueOnce(baseLayout)
      .mockRejectedValueOnce(new Error("parse error")) // settings_check throws
      .mockResolvedValueOnce("/ws/.markspread/settings.json.broken-1") // recover
      .mockResolvedValueOnce({ kind: "internal", case_preserving_only: false });
    askMock.mockResolvedValueOnce(true);
    const { openWorkspaceFromDialog } = await import("./open-workspace");
    await openWorkspaceFromDialog();
    expect(useWorkspace.getState().current).toBe("/ws");
  });

  it("aborts when the user declines settings recovery", async () => {
    openDialogMock.mockResolvedValueOnce("/ws");
    invokeMock
      .mockResolvedValueOnce({
        root: "/ws",
        already_existed: true,
        settings_schema_version: 1,
        current_schema_version: 2,
        index_db_corrupt: false,
        read_only: false,
      })
      .mockResolvedValueOnce(baseLayout)
      .mockRejectedValueOnce(new Error("parse error"));
    askMock.mockResolvedValueOnce(false);
    const { openWorkspaceFromDialog } = await import("./open-workspace");
    await openWorkspaceFromDialog();
    expect(useWorkspace.getState().current).toBeNull();
  });

  it("warns on an external drive and read-only workspace", async () => {
    openDialogMock.mockResolvedValueOnce("/ws");
    invokeMock
      .mockResolvedValueOnce({
        root: "/ws",
        already_existed: true,
        settings_schema_version: 1,
        current_schema_version: 2,
        index_db_corrupt: false,
        read_only: true,
      })
      .mockResolvedValueOnce({ ...baseLayout, read_only: true })
      .mockResolvedValueOnce(true)
      .mockResolvedValueOnce({ kind: "external", case_preserving_only: true });
    const { openWorkspaceFromDialog } = await import("./open-workspace");
    await openWorkspaceFromDialog();
    const msgs = useToasts.getState().toasts.map((t) => t.message);
    expect(msgs).toContain("workspace.warn.external_drive");
    expect(msgs).toContain("workspace.read_only.notice");
  });

  it("warns about a long workspace path", async () => {
    const longRoot = `/${"x".repeat(300)}`;
    openDialogMock.mockResolvedValueOnce(longRoot);
    invokeMock
      .mockResolvedValueOnce({
        root: longRoot,
        already_existed: true,
        settings_schema_version: 1,
        current_schema_version: 2,
        index_db_corrupt: false,
        read_only: false,
      })
      .mockResolvedValueOnce({ ...baseLayout, root: longRoot })
      .mockResolvedValueOnce(true)
      .mockResolvedValueOnce({ kind: "internal", case_preserving_only: false });
    const { openWorkspaceFromDialog } = await import("./open-workspace");
    await openWorkspaceFromDialog();
    const msgs = useToasts.getState().toasts.map((t) => t.message);
    expect(msgs).toContain("workspace.warn.long_path");
  });
});

describe("newWorkspaceFromDialog", () => {
  it("returns null when cancelled", async () => {
    openDialogMock.mockResolvedValueOnce(null);
    const { newWorkspaceFromDialog } = await import("./open-workspace");
    expect(await newWorkspaceFromDialog()).toBeNull();
  });

  it("scaffolds a fresh folder", async () => {
    openDialogMock.mockResolvedValueOnce("/ws");
    invokeMock
      .mockResolvedValueOnce({ ...baseLayout, already_existed: false })
      .mockResolvedValueOnce(true)
      .mockResolvedValueOnce({ kind: "internal", case_preserving_only: false });
    const { newWorkspaceFromDialog } = await import("./open-workspace");
    expect(await newWorkspaceFromDialog()).toBe("/ws");
    expect(useWorkspace.getState().current).toBe("/ws");
  });

  it("confirms re-opening an already-initialised folder", async () => {
    openDialogMock.mockResolvedValueOnce("/ws");
    invokeMock.mockResolvedValueOnce(baseLayout);
    askMock.mockResolvedValueOnce(false);
    const { newWorkspaceFromDialog } = await import("./open-workspace");
    expect(await newWorkspaceFromDialog()).toBeNull();
  });

  it("presents an error when scaffold fails", async () => {
    openDialogMock.mockResolvedValueOnce("/ws");
    invokeMock.mockRejectedValueOnce("scaffold boom");
    const { newWorkspaceFromDialog } = await import("./open-workspace");
    expect(await newWorkspaceFromDialog()).toBeNull();
    expect(useToasts.getState().toasts[0]?.message).toContain("scaffold boom");
  });
});
