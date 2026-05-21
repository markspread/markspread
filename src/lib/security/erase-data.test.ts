import { afterEach, describe, expect, it, vi } from "vitest";

const invoke = vi.fn<(cmd: string, args?: unknown) => Promise<unknown>>();
vi.mock("@tauri-apps/api/core", () => ({
  invoke: (cmd: string, args?: unknown) => invoke(cmd, args),
}));

import {
  ERASE_CONFIRMATION_TOKEN,
  type EraseOptions,
  type EraseReport,
  eraseAllData,
  isConfirmationValid,
  summariseReport,
} from "./erase-data";

afterEach(() => {
  invoke.mockReset();
});

describe("isConfirmationValid", () => {
  it("accepts only the exact ERASE token", () => {
    expect(isConfirmationValid(ERASE_CONFIRMATION_TOKEN)).toBe(true);
    expect(isConfirmationValid("erase")).toBe(false);
    expect(isConfirmationValid(" ERASE ")).toBe(false);
    expect(isConfirmationValid("")).toBe(false);
  });
});

describe("eraseAllData", () => {
  it("forwards opts to security_erase_all_data and returns the report", async () => {
    const opts: EraseOptions = {
      wipeAppData: true,
      wipeWorkspaceState: true,
      wipeKeychain: true,
      selfUninstall: false,
    };
    const report: EraseReport = {
      appDataRemoved: [],
      workspaceStateRemoved: [],
      keychainItemsRemoved: [],
      errors: [],
      selfUninstall: null,
      totalBytesRemoved: 0,
      startedAt: 1,
      finishedAt: 2,
    };
    invoke.mockResolvedValueOnce(report);
    const result = await eraseAllData(opts);
    expect(invoke).toHaveBeenCalledWith("security_erase_all_data", { opts });
    expect(result).toBe(report);
  });
});

describe("summariseReport", () => {
  const empty: EraseReport = {
    appDataRemoved: [],
    workspaceStateRemoved: [],
    keychainItemsRemoved: [],
    errors: [],
    selfUninstall: null,
    totalBytesRemoved: 0,
    startedAt: 0,
    finishedAt: 0,
  };

  it("emits no rows for a fully empty report", () => {
    expect(summariseReport(empty)).toEqual([]);
  });

  it("renders bytes with the right unit at each magnitude", () => {
    const r: EraseReport = {
      ...empty,
      appDataRemoved: [{ path: "/a", bytes: 512 }],
    };
    expect(summariseReport(r)[0]?.detail).toContain("512 B");

    const kbReport: EraseReport = {
      ...empty,
      workspaceStateRemoved: [{ path: "/b", bytes: 2 * 1024 }],
    };
    expect(summariseReport(kbReport)[0]?.detail).toContain("KB");

    const mbReport: EraseReport = {
      ...empty,
      appDataRemoved: [{ path: "/c", bytes: 3 * 1024 * 1024 }],
    };
    expect(summariseReport(mbReport)[0]?.detail).toContain("MB");

    const gbReport: EraseReport = {
      ...empty,
      appDataRemoved: [{ path: "/d", bytes: 4 * 1024 * 1024 * 1024 }],
    };
    expect(summariseReport(gbReport)[0]?.detail).toContain("GB");

    const tbReport: EraseReport = {
      ...empty,
      appDataRemoved: [{ path: "/e", bytes: 5 * 1024 ** 4 }],
    };
    expect(summariseReport(tbReport)[0]?.detail).toContain("TB");

    // Beyond TB still caps at TB (loop exits with i = units.length - 1).
    const beyondTb: EraseReport = {
      ...empty,
      appDataRemoved: [{ path: "/f", bytes: 6 * 1024 ** 5 }],
    };
    expect(summariseReport(beyondTb)[0]?.detail).toContain("TB");
  });

  it("includes every populated section with its label", () => {
    const r: EraseReport = {
      appDataRemoved: [{ path: "/a", bytes: 100 }],
      workspaceStateRemoved: [{ path: "/b", bytes: 200 }],
      keychainItemsRemoved: [{ alias: "api-key" }],
      errors: [{ path: "/x", reason: "EACCES" }],
      selfUninstall: {
        platform: "macos",
        scheduled: true,
        artifact: "/Users/x/.Trash/Markspread.app",
        message: "Markspread will exit in 5s",
      },
      totalBytesRemoved: 300,
      startedAt: 0,
      finishedAt: 100,
    };
    const labels = summariseReport(r).map((row) => row.label);
    expect(labels).toEqual([
      "App data",
      "Workspace state",
      "Keychain",
      "Could not remove",
      "Self-uninstall",
    ]);
  });
});
