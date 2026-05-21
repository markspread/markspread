// Theme store: setMode/syncFromSystem branches plus the top-level
// matchMedia listener wiring.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

type MediaListener = (e: MediaQueryListEvent) => void;

interface FakeMediaQueryList {
  matches: boolean;
  addEventListener: (type: "change", cb: MediaListener) => void;
}

let matches = false;
const listeners: MediaListener[] = [];
let originalMatchMedia: typeof window.matchMedia | undefined;

beforeEach(() => {
  vi.resetModules();
  matches = false;
  listeners.length = 0;
  originalMatchMedia = window.matchMedia;
  Object.defineProperty(window, "matchMedia", {
    configurable: true,
    value: (): FakeMediaQueryList => ({
      get matches() {
        return matches;
      },
      addEventListener: (_t, cb) => listeners.push(cb),
    }),
  });
});

afterEach(() => {
  if (originalMatchMedia) {
    Object.defineProperty(window, "matchMedia", {
      configurable: true,
      value: originalMatchMedia,
    });
  }
});

describe("theme store", () => {
  it("setMode applies the resolved theme and persists the mode", async () => {
    const { useTheme } = await import("./theme");
    useTheme.getState().setMode("dark");
    expect(useTheme.getState().mode).toBe("dark");
    expect(useTheme.getState().resolved).toBe("dark");
    expect(document.documentElement.dataset.theme).toBe("dark");
  });

  it("setMode('system') resolves via matchMedia", async () => {
    matches = true;
    const { useTheme } = await import("./theme");
    useTheme.getState().setMode("system");
    expect(useTheme.getState().resolved).toBe("dark");
  });

  it("syncFromSystem updates resolved only when mode is system", async () => {
    const { useTheme } = await import("./theme");
    useTheme.getState().setMode("light");
    matches = true;
    useTheme.getState().syncFromSystem();
    // Mode was 'light', so syncFromSystem should be a no-op.
    expect(useTheme.getState().resolved).toBe("light");

    useTheme.getState().setMode("system");
    useTheme.getState().syncFromSystem();
    expect(useTheme.getState().resolved).toBe("dark");
  });

  it("onRehydrateStorage re-resolves the theme using the persisted mode", async () => {
    window.localStorage.setItem(
      "markspread.theme",
      JSON.stringify({ state: { mode: "dark", resolved: "light" }, version: 0 }),
    );
    const { useTheme } = await import("./theme");
    expect(useTheme.getState().resolved).toBe("dark");
    expect(document.documentElement.dataset.theme).toBe("dark");
    window.localStorage.removeItem("markspread.theme");
  });

  it("onRehydrateStorage routes 'system' mode through matchMedia", async () => {
    matches = true;
    window.localStorage.setItem(
      "markspread.theme",
      JSON.stringify({ state: { mode: "system", resolved: "light" }, version: 0 }),
    );
    const { useTheme } = await import("./theme");
    expect(useTheme.getState().resolved).toBe("dark");
    window.localStorage.removeItem("markspread.theme");
  });

  it("media-change listener routes through syncFromSystem", async () => {
    const { useTheme } = await import("./theme");
    useTheme.getState().setMode("system");
    matches = true;
    // The module registered one change listener at import time.
    expect(listeners.length).toBeGreaterThan(0);
    listeners[0]?.({} as MediaQueryListEvent);
    expect(useTheme.getState().resolved).toBe("dark");
  });
});
