// window-id label resolution + persist-key derivation.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const invokeMock = vi.fn();
vi.mock("@tauri-apps/api/core", () => ({
  invoke: (...args: unknown[]) => invokeMock(...args),
}));

beforeEach(() => {
  invokeMock.mockReset();
  vi.resetModules();
});

afterEach(() => {
  invokeMock.mockReset();
});

describe("getWindowInfo", () => {
  it("resolves and caches the window info", async () => {
    invokeMock.mockResolvedValueOnce({ label: "secondary", is_primary: false });
    const mod = await import("./window-id");
    const first = await mod.getWindowInfo();
    expect(first).toEqual({ label: "secondary", is_primary: false });
    const second = await mod.getWindowInfo();
    expect(second).toBe(first);
    expect(invokeMock).toHaveBeenCalledTimes(1);
  });

  it("falls back to main when invoke rejects", async () => {
    invokeMock.mockRejectedValueOnce(new Error("no runtime"));
    const mod = await import("./window-id");
    const info = await mod.getWindowInfo();
    expect(info).toEqual({ label: "main", is_primary: true });
  });
});

describe("syncWindowLabel", () => {
  it("returns main before getWindowInfo resolves", async () => {
    const mod = await import("./window-id");
    expect(mod.syncWindowLabel()).toBe("main");
  });

  it("returns the resolved label after getWindowInfo", async () => {
    invokeMock.mockResolvedValueOnce({ label: "win-2", is_primary: false });
    const mod = await import("./window-id");
    await mod.getWindowInfo();
    expect(mod.syncWindowLabel()).toBe("win-2");
  });
});

describe("persistKeyFor", () => {
  it("returns the bare base on the main window", async () => {
    const mod = await import("./window-id");
    expect(mod.persistKeyFor("markspread.tabs")).toBe("markspread.tabs");
  });

  it("suffixes the base with a non-main label", async () => {
    invokeMock.mockResolvedValueOnce({ label: "win-3", is_primary: false });
    const mod = await import("./window-id");
    await mod.getWindowInfo();
    expect(mod.persistKeyFor("markspread.tabs")).toBe("markspread.tabs.win-3");
  });
});
