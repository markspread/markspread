// S-OP-008: safe-mode toggle wrapper coverage.

import { beforeEach, describe, expect, it, vi } from "vitest";

const invokeMock = vi.fn();
vi.mock("@tauri-apps/api/core", () => ({
  invoke: (...args: unknown[]) => invokeMock(...args),
}));

import { getSafeMode, setSafeMode } from "./safe-mode";

beforeEach(() => {
  invokeMock.mockReset();
});

describe("getSafeMode", () => {
  it("returns the backend value", async () => {
    invokeMock.mockResolvedValue(true);
    expect(await getSafeMode()).toBe(true);
    expect(invokeMock).toHaveBeenCalledWith("ops_safe_mode_get");
  });
});

describe("setSafeMode", () => {
  it("forwards the enabled flag", async () => {
    invokeMock.mockResolvedValue(undefined);
    await setSafeMode(false);
    expect(invokeMock).toHaveBeenCalledWith("ops_safe_mode_set", { enabled: false });
  });
});
