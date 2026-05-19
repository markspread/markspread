// S-TH-003 / S-TH-010: bindSystemTheme listener coverage.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

interface FakeMql {
  matches: boolean;
  media: string;
  addEventListener: ReturnType<typeof vi.fn>;
  removeEventListener: ReturnType<typeof vi.fn>;
}

function makeMql(media: string): FakeMql {
  return { matches: false, media, addEventListener: vi.fn(), removeEventListener: vi.fn() };
}

beforeEach(() => {
  vi.resetModules();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("bindSystemTheme", () => {
  it("returns a no-op when matchMedia is unavailable", async () => {
    const original = window.matchMedia;
    // @ts-expect-error — deliberately remove for the unsupported path.
    window.matchMedia = undefined;
    const { bindSystemTheme } = await import("./system");
    const unbind = bindSystemTheme();
    expect(typeof unbind).toBe("function");
    unbind();
    window.matchMedia = original;
  });

  it("adds change listeners for color-scheme and contrast", async () => {
    const mqls = new Map<string, FakeMql>();
    vi.spyOn(window, "matchMedia").mockImplementation((q: string) => {
      const m = mqls.get(q) ?? makeMql(q);
      mqls.set(q, m);
      return m as unknown as MediaQueryList;
    });
    const { bindSystemTheme } = await import("./system");
    const unbind = bindSystemTheme();
    expect(mqls.get("(prefers-color-scheme: dark)")?.addEventListener).toHaveBeenCalled();
    expect(mqls.get("(prefers-contrast: more)")?.addEventListener).toHaveBeenCalled();
    unbind();
    expect(mqls.get("(prefers-color-scheme: dark)")?.removeEventListener).toHaveBeenCalled();
  });

  it("is idempotent — a second call returns a no-op while installed", async () => {
    vi.spyOn(window, "matchMedia").mockImplementation(
      (q: string) => makeMql(q) as unknown as MediaQueryList,
    );
    const { bindSystemTheme } = await import("./system");
    bindSystemTheme();
    const second = bindSystemTheme();
    expect(typeof second).toBe("function");
    second();
  });

  it("re-applies the theme when the system flips and mode is system", async () => {
    const mqls = new Map<string, FakeMql>();
    vi.spyOn(window, "matchMedia").mockImplementation((q: string) => {
      const m = mqls.get(q) ?? makeMql(q);
      mqls.set(q, m);
      return m as unknown as MediaQueryList;
    });
    const { bindSystemTheme } = await import("./system");
    const registry = await import("./registry");
    registry.applyTheme({ themeId: "default-light", mode: "system", contrast: "auto" });
    const applySpy = vi.spyOn(registry, "applyTheme");
    bindSystemTheme();
    const handler = mqls.get("(prefers-color-scheme: dark)")?.addEventListener.mock
      .calls[0]?.[1] as () => void;
    handler();
    expect(applySpy).toHaveBeenCalledWith({});
  });

  it("does not re-apply when mode is fixed and contrast is high", async () => {
    const mqls = new Map<string, FakeMql>();
    vi.spyOn(window, "matchMedia").mockImplementation((q: string) => {
      const m = mqls.get(q) ?? makeMql(q);
      mqls.set(q, m);
      return m as unknown as MediaQueryList;
    });
    const { bindSystemTheme } = await import("./system");
    const registry = await import("./registry");
    registry.applyTheme({ themeId: "default-light", mode: "light", contrast: "high" });
    const applySpy = vi.spyOn(registry, "applyTheme");
    bindSystemTheme();
    const handler = mqls.get("(prefers-contrast: more)")?.addEventListener.mock
      .calls[0]?.[1] as () => void;
    handler();
    expect(applySpy).not.toHaveBeenCalled();
  });
});
