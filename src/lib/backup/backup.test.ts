// S-BK-001..007: backup IPC wrapper coverage.

import { beforeEach, describe, expect, it, vi } from "vitest";

const invokeMock = vi.fn();
vi.mock("@tauri-apps/api/core", () => ({
  invoke: (...args: unknown[]) => invokeMock(...args),
}));

import {
  DEFAULT_SNAPSHOT_CONFIG,
  SNAPSHOT_INTERVAL_MS,
  SNAPSHOT_RETENTION_DAYS,
  exportKeybindings,
  exportSettings,
  exportWorkspace,
  importKeybindings,
  importSettings,
  importWorkspace,
  listSnapshots,
  proposeRecovery,
  restoreSnapshot,
} from "./backup";

beforeEach(() => {
  invokeMock.mockReset();
});

describe("constants", () => {
  it("exposes the snapshot cadence defaults", () => {
    expect(SNAPSHOT_INTERVAL_MS).toBe(300_000);
    expect(SNAPSHOT_RETENTION_DAYS).toBe(7);
    expect(DEFAULT_SNAPSHOT_CONFIG).toEqual({
      enabled: true,
      intervalMs: SNAPSHOT_INTERVAL_MS,
      retentionDays: SNAPSHOT_RETENTION_DAYS,
      excludedWorkspaces: [],
    });
  });
});

describe("snapshot IPC wrappers", () => {
  it("listSnapshots forwards the workspace hash", async () => {
    invokeMock.mockResolvedValue([]);
    await listSnapshots("hash-1");
    expect(invokeMock).toHaveBeenCalledWith("backup_snapshot_list", { workspaceHash: "hash-1" });
  });

  it("restoreSnapshot forwards the id", async () => {
    invokeMock.mockResolvedValue({ filesRestored: 3 });
    await expect(restoreSnapshot("snap-1")).resolves.toEqual({ filesRestored: 3 });
    expect(invokeMock).toHaveBeenCalledWith("backup_snapshot_restore", { id: "snap-1" });
  });

  it("proposeRecovery forwards the workspace hash", async () => {
    invokeMock.mockResolvedValue({ workspaceHash: "h", snapshots: [], lastSessionEndedAt: null });
    await proposeRecovery("h");
    expect(invokeMock).toHaveBeenCalledWith("backup_propose_recovery", { workspaceHash: "h" });
  });
});

describe("workspace export/import", () => {
  it("exportWorkspace forwards the request object", async () => {
    invokeMock.mockResolvedValue({ outputPath: "/out.zip", bytes: 10 });
    const req = { workspacePath: "/ws", outputPath: null, includeMarkspreadFolder: true };
    await exportWorkspace(req);
    expect(invokeMock).toHaveBeenCalledWith("backup_workspace_export", { req });
  });

  it("importWorkspace forwards the zip path and destination", async () => {
    invokeMock.mockResolvedValue({ filesRestored: 5 });
    await importWorkspace("/in.zip", "/dest");
    expect(invokeMock).toHaveBeenCalledWith("backup_workspace_import", {
      zipPath: "/in.zip",
      destination: "/dest",
    });
  });
});

describe("settings export/import", () => {
  it("exportSettings invokes the backend command", async () => {
    invokeMock.mockResolvedValue({ schemaVersion: 1, exportedAt: 0, settings: {}, plugins: [] });
    await exportSettings();
    expect(invokeMock).toHaveBeenCalledWith("backup_settings_export");
  });

  it("importSettings forwards the payload", async () => {
    invokeMock.mockResolvedValue({ ok: true, warnings: [] });
    const payload = { schemaVersion: 1 as const, exportedAt: 0, settings: {}, plugins: [] };
    await importSettings(payload);
    expect(invokeMock).toHaveBeenCalledWith("backup_settings_import", { payload });
  });
});

describe("keybinding export/import", () => {
  it("exportKeybindings invokes the backend command", async () => {
    invokeMock.mockResolvedValue({ schemaVersion: 1, exportedAt: 0, bindings: [] });
    await exportKeybindings();
    expect(invokeMock).toHaveBeenCalledWith("backup_keybindings_export");
  });

  it("importKeybindings forwards the payload", async () => {
    invokeMock.mockResolvedValue({ ok: true, conflicts: [] });
    const payload = { schemaVersion: 1 as const, exportedAt: 0, bindings: [] };
    await importKeybindings(payload);
    expect(invokeMock).toHaveBeenCalledWith("backup_keybindings_import", { payload });
  });
});
