// startup first-paint reporting.

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
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("markFirstPaint", () => {
  it("reports first paint once via requestAnimationFrame", async () => {
    invokeMock.mockResolvedValue({ first_paint_ms: 42 });
    const info = vi.spyOn(console, "info").mockImplementation(() => {});
    const raf = vi.fn((cb: FrameRequestCallback) => {
      cb(0);
      return 1;
    });
    vi.stubGlobal("requestAnimationFrame", raf);

    const { markFirstPaint } = await import("./startup");
    markFirstPaint();
    expect(raf).toHaveBeenCalled();
    await Promise.resolve();
    await Promise.resolve();
    expect(invokeMock).toHaveBeenCalledWith("startup_mark_first_paint");
    expect(info).toHaveBeenCalledWith(expect.stringContaining("42ms"));
  });

  it("only reports once even on repeated calls", async () => {
    invokeMock.mockResolvedValue({ first_paint_ms: 1 });
    vi.spyOn(console, "info").mockImplementation(() => {});
    const raf = vi.fn((cb: FrameRequestCallback) => {
      cb(0);
      return 1;
    });
    vi.stubGlobal("requestAnimationFrame", raf);

    const { markFirstPaint } = await import("./startup");
    markFirstPaint();
    markFirstPaint();
    markFirstPaint();
    await Promise.resolve();
    await Promise.resolve();
    expect(invokeMock).toHaveBeenCalledTimes(1);
  });

  it("falls back to queueMicrotask when rAF is unavailable", async () => {
    invokeMock.mockResolvedValue({ first_paint_ms: 7 });
    vi.spyOn(console, "info").mockImplementation(() => {});
    vi.stubGlobal("requestAnimationFrame", undefined);

    const { markFirstPaint } = await import("./startup");
    markFirstPaint();
    await Promise.resolve();
    await Promise.resolve();
    expect(invokeMock).toHaveBeenCalledWith("startup_mark_first_paint");
  });

  it("swallows a rejected invoke", async () => {
    invokeMock.mockRejectedValue(new Error("no runtime"));
    const raf = vi.fn((cb: FrameRequestCallback) => {
      cb(0);
      return 1;
    });
    vi.stubGlobal("requestAnimationFrame", raf);

    const { markFirstPaint } = await import("./startup");
    expect(() => markFirstPaint()).not.toThrow();
    await Promise.resolve();
    await Promise.resolve();
  });
});
