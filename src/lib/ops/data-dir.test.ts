// S-OP-006: data-dir reveal coverage.

import { beforeEach, describe, expect, it, vi } from "vitest";

const invokeMock = vi.fn();
const mkdirMock = vi.fn();

vi.mock("@tauri-apps/api/core", () => ({
  invoke: (...args: unknown[]) => invokeMock(...args),
}));
vi.mock("@tauri-apps/plugin-fs", () => ({
  mkdir: (...args: unknown[]) => mkdirMock(...args),
}));

import { getDataDirInfo, revealDataDir } from "./data-dir";

beforeEach(() => {
  invokeMock.mockReset();
  mkdirMock.mockReset();
});

describe("getDataDirInfo", () => {
  it("invokes the info command", async () => {
    invokeMock.mockResolvedValue({ path: "/data", exists: true });
    expect(await getDataDirInfo()).toEqual({ path: "/data", exists: true });
    expect(invokeMock).toHaveBeenCalledWith("ops_data_dir_info");
  });
});

describe("revealDataDir", () => {
  it("reveals an existing directory without creating it", async () => {
    invokeMock.mockResolvedValueOnce({ path: "/data", exists: true });
    invokeMock.mockResolvedValueOnce(undefined);
    const info = await revealDataDir();
    expect(mkdirMock).not.toHaveBeenCalled();
    expect(invokeMock).toHaveBeenCalledWith("os_reveal_path", { path: "/data" });
    expect(info.exists).toBe(true);
  });

  it("creates the directory when it does not exist", async () => {
    invokeMock.mockResolvedValueOnce({ path: "/data", exists: false });
    mkdirMock.mockResolvedValue(undefined);
    invokeMock.mockResolvedValueOnce(undefined);
    await revealDataDir();
    expect(mkdirMock).toHaveBeenCalledWith("/data", { recursive: true });
    expect(invokeMock).toHaveBeenCalledWith("os_reveal_path", { path: "/data" });
  });

  it("still reveals when directory creation fails", async () => {
    invokeMock.mockResolvedValueOnce({ path: "/data", exists: false });
    mkdirMock.mockRejectedValue(new Error("read-only parent"));
    invokeMock.mockResolvedValueOnce(undefined);
    await expect(revealDataDir()).resolves.toEqual({ path: "/data", exists: false });
    expect(invokeMock).toHaveBeenCalledWith("os_reveal_path", { path: "/data" });
  });
});
