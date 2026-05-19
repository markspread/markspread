// S-OP-001..007: erase / cache-clean wrapper coverage.

import { beforeEach, describe, expect, it, vi } from "vitest";

const invokeMock = vi.fn();
vi.mock("@tauri-apps/api/core", () => ({
  invoke: (...args: unknown[]) => invokeMock(...args),
}));

import {
  ERASE_CONFIRMATION_TOKEN,
  EraseConfirmationError,
  cleanCache,
  eraseAiKeys,
  eraseAllData,
  eraseWorkspaceIndex,
} from "./erase";

beforeEach(() => {
  invokeMock.mockReset();
});

describe("eraseAllData", () => {
  it("invokes the erase command when the token matches", async () => {
    const report = {
      dataDirRemoved: true,
      dataDirPath: "/data",
      keychainItemsRemoved: [],
      keychainItemsMissing: [],
    };
    invokeMock.mockResolvedValue(report);
    await expect(eraseAllData(ERASE_CONFIRMATION_TOKEN)).resolves.toEqual(report);
    expect(invokeMock).toHaveBeenCalledWith("ops_erase_all", {
      confirmation: ERASE_CONFIRMATION_TOKEN,
    });
  });

  it("throws EraseConfirmationError on a token mismatch", async () => {
    await expect(eraseAllData("wrong")).rejects.toBeInstanceOf(EraseConfirmationError);
    expect(invokeMock).not.toHaveBeenCalled();
  });

  it("EraseConfirmationError carries a helpful message and name", () => {
    const err = new EraseConfirmationError();
    expect(err.name).toBe("EraseConfirmationError");
    expect(err.message).toContain(ERASE_CONFIRMATION_TOKEN);
  });
});

describe("eraseWorkspaceIndex", () => {
  it("forwards the workspace path", async () => {
    invokeMock.mockResolvedValue({
      workspace: "/ws",
      hadInMemoryIndex: true,
      onDiskIndexRemoved: true,
      rebuildTriggered: true,
    });
    await eraseWorkspaceIndex("/ws");
    expect(invokeMock).toHaveBeenCalledWith("ops_erase_index", { workspace: "/ws" });
  });
});

describe("eraseAiKeys", () => {
  it("invokes the AI-key erase command", async () => {
    invokeMock.mockResolvedValue({
      dataDirRemoved: false,
      dataDirPath: "/data",
      keychainItemsRemoved: ["openai"],
      keychainItemsMissing: [],
    });
    await eraseAiKeys();
    expect(invokeMock).toHaveBeenCalledWith("ops_erase_ai_keys");
  });
});

describe("cleanCache", () => {
  it("invokes the cache-clean command", async () => {
    invokeMock.mockResolvedValue({ bytesFreed: 1024, pathsRemoved: ["/cache"] });
    expect(await cleanCache()).toEqual({ bytesFreed: 1024, pathsRemoved: ["/cache"] });
    expect(invokeMock).toHaveBeenCalledWith("ops_clean_cache");
  });
});
