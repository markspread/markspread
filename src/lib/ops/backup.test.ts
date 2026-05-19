// S-OP-005: settings backup/restore wrapper coverage.

import { beforeEach, describe, expect, it, vi } from "vitest";
import type { SettingsBackup } from "./backup";

const invokeMock = vi.fn();
const saveMock = vi.fn();
const openMock = vi.fn();
const readTextFileMock = vi.fn();
const writeTextFileMock = vi.fn();

vi.mock("@tauri-apps/api/core", () => ({
  invoke: (...args: unknown[]) => invokeMock(...args),
}));
vi.mock("@tauri-apps/plugin-dialog", () => ({
  save: (...args: unknown[]) => saveMock(...args),
  open: (...args: unknown[]) => openMock(...args),
}));
vi.mock("@tauri-apps/plugin-fs", () => ({
  readTextFile: (...args: unknown[]) => readTextFileMock(...args),
  writeTextFile: (...args: unknown[]) => writeTextFileMock(...args),
}));

import { exportSettingsBackup, importSettingsBackup } from "./backup";

const backup: SettingsBackup = {
  envelopeVersion: 1,
  appVersion: "1.0.0",
  generatedAtMs: Date.UTC(2026, 0, 2, 3, 4, 5),
  payloadSha256: "abc",
  payload: { settings: {}, keybindings: {}, snippets: null },
};

beforeEach(() => {
  invokeMock.mockReset();
  saveMock.mockReset();
  openMock.mockReset();
  readTextFileMock.mockReset();
  writeTextFileMock.mockReset();
});

describe("exportSettingsBackup", () => {
  it("writes the backup JSON to the chosen path", async () => {
    invokeMock.mockResolvedValue(backup);
    saveMock.mockResolvedValue("/chosen/backup.json");
    writeTextFileMock.mockResolvedValue(undefined);
    const path = await exportSettingsBackup();
    expect(invokeMock).toHaveBeenCalledWith("ops_settings_backup");
    expect(saveMock).toHaveBeenCalledWith(
      expect.objectContaining({
        defaultPath: expect.stringMatching(/^markspread-settings-.*\.json$/),
      }),
    );
    expect(writeTextFileMock).toHaveBeenCalledWith(
      "/chosen/backup.json",
      JSON.stringify(backup, null, 2),
    );
    expect(path).toBe("/chosen/backup.json");
  });

  it("returns null and writes nothing when the dialog is cancelled", async () => {
    invokeMock.mockResolvedValue(backup);
    saveMock.mockResolvedValue(null);
    expect(await exportSettingsBackup()).toBeNull();
    expect(writeTextFileMock).not.toHaveBeenCalled();
  });
});

describe("importSettingsBackup", () => {
  it("reads, parses and restores the backup", async () => {
    openMock.mockResolvedValue("/in/backup.json");
    readTextFileMock.mockResolvedValue(JSON.stringify(backup));
    invokeMock.mockResolvedValue(undefined);
    expect(await importSettingsBackup()).toBe(true);
    expect(invokeMock).toHaveBeenCalledWith("ops_settings_restore", { backup });
  });

  it("returns false when the open dialog is cancelled", async () => {
    openMock.mockResolvedValue(null);
    expect(await importSettingsBackup()).toBe(false);
    expect(invokeMock).not.toHaveBeenCalled();
  });

  it("returns false when the open dialog yields a non-string (multi-select)", async () => {
    openMock.mockResolvedValue(["/a.json", "/b.json"]);
    expect(await importSettingsBackup()).toBe(false);
    expect(readTextFileMock).not.toHaveBeenCalled();
  });
});
