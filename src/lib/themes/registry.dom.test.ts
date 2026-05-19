// S-TH-001..010: theme registry + applier coverage.

import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  type ThemeDefinition,
  applyTheme,
  getActiveTheme,
  getTheme,
  importThemeJson,
  listThemes,
  registerTheme,
  subscribeTheme,
} from "./registry";

function makeTheme(id: string): ThemeDefinition {
  return {
    id,
    name: `Theme ${id}`,
    mode: "light",
    light: { tokens: { "--ms-color-bg": "#fff" }, shiki: "github-light" },
    dark: { tokens: { "--ms-color-bg": "#000" }, shiki: "github-dark" },
  };
}

beforeEach(() => {
  // Reset applier state back to defaults between tests.
  applyTheme({ themeId: "default-light", mode: "system", vision: "default", contrast: "auto" });
});

describe("registerTheme / listThemes / getTheme", () => {
  it("registers and unregisters a theme", () => {
    const unregister = registerTheme(makeTheme("temp-a"));
    expect(getTheme("temp-a")?.name).toBe("Theme temp-a");
    expect(listThemes().some((t) => t.id === "temp-a")).toBe(true);
    unregister();
    expect(getTheme("temp-a")).toBeUndefined();
  });

  it("includes the bootstrap defaults", () => {
    expect(getTheme("default-light")).toBeDefined();
    expect(getTheme("default-dark")).toBeDefined();
  });
});

describe("subscribeTheme", () => {
  it("notifies listeners on register and apply, and stops after unsubscribe", () => {
    const fn = vi.fn();
    const off = subscribeTheme(fn);
    const unregister = registerTheme(makeTheme("temp-sub"));
    expect(fn).toHaveBeenCalled();
    fn.mockClear();
    applyTheme({});
    expect(fn).toHaveBeenCalled();
    off();
    fn.mockClear();
    unregister();
    expect(fn).not.toHaveBeenCalled();
  });
});

describe("applyTheme", () => {
  it("writes light tokens onto the document root", () => {
    applyTheme({ themeId: "default-light", mode: "light" });
    const root = document.documentElement;
    expect(root.style.getPropertyValue("--ms-color-bg")).toBe("#ffffff");
    expect(root.dataset.theme).toBe("light");
    expect(root.dataset.themeId).toBe("default-light");
    expect(root.dataset.vision).toBe("default");
  });

  it("uses dark tokens when mode is dark and a dark table exists", () => {
    applyTheme({ themeId: "default-light", mode: "dark" });
    expect(document.documentElement.style.getPropertyValue("--ms-color-bg")).toBe("#0d1117");
  });

  it("falls back to light tokens when the theme has no dark table", () => {
    registerTheme({
      id: "light-only",
      name: "Light Only",
      mode: "light",
      light: { tokens: { "--ms-color-bg": "#abcdef" }, shiki: "x" },
    });
    applyTheme({ themeId: "light-only", mode: "dark" });
    expect(document.documentElement.style.getPropertyValue("--ms-color-bg")).toBe("#abcdef");
  });

  it("falls back to default-light when the theme id is unknown", () => {
    applyTheme({ themeId: "does-not-exist" });
    expect(document.documentElement.dataset.themeId).toBe("default-light");
  });

  it("layers vision overrides on top of base tokens", () => {
    applyTheme({ themeId: "default-light", mode: "light", vision: "deuteranopia" });
    expect(document.documentElement.style.getPropertyValue("--ms-color-success")).toBe("#2563eb");
    applyTheme({ vision: "protanopia" });
    expect(document.documentElement.style.getPropertyValue("--ms-color-success")).toBe("#0ea5e9");
  });

  it("removes vision tokens when switching back to default", () => {
    applyTheme({ themeId: "default-light", mode: "light", vision: "deuteranopia" });
    applyTheme({ vision: "default" });
    expect(document.documentElement.style.getPropertyValue("--ms-color-success")).toBe("#1a7f37");
  });

  it("layers high-contrast overrides when contrast is high", () => {
    applyTheme({ themeId: "default-light", mode: "light", contrast: "high" });
    expect(document.documentElement.style.getPropertyValue("--ms-color-fg")).toBe("#000000");
    applyTheme({ mode: "dark", contrast: "high" });
    expect(document.documentElement.style.getPropertyValue("--ms-color-fg")).toBe("#ffffff");
  });

  it("resolves system mode via matchMedia", () => {
    const spy = vi.spyOn(window, "matchMedia").mockImplementation(
      (q: string) =>
        ({
          matches: q.includes("dark"),
          media: q,
          addEventListener: vi.fn(),
          removeEventListener: vi.fn(),
        }) as unknown as MediaQueryList,
    );
    applyTheme({ themeId: "default-light", mode: "system" });
    expect(document.documentElement.dataset.theme).toBe("dark");
    spy.mockRestore();
  });

  it("applies high contrast automatically when the system prefers it", () => {
    const spy = vi.spyOn(window, "matchMedia").mockImplementation(
      (q: string) =>
        ({
          matches: q.includes("prefers-contrast"),
          media: q,
          addEventListener: vi.fn(),
          removeEventListener: vi.fn(),
        }) as unknown as MediaQueryList,
    );
    applyTheme({ themeId: "default-light", mode: "light", contrast: "auto" });
    expect(document.documentElement.style.getPropertyValue("--ms-color-fg")).toBe("#000000");
    spy.mockRestore();
  });
});

describe("getActiveTheme", () => {
  it("reports the current active selection", () => {
    applyTheme({ themeId: "default-dark", mode: "dark", vision: "protanopia", contrast: "high" });
    const active = getActiveTheme();
    expect(active.themeId).toBe("default-dark");
    expect(active.mode).toBe("dark");
    expect(active.vision).toBe("protanopia");
    expect(active.contrast).toBe("high");
    expect(active.shiki).toBe("github-dark");
  });

  it("falls back to github-light shiki when the active theme is missing", () => {
    applyTheme({ themeId: "default-light" });
    const unregister = registerTheme(makeTheme("ghost"));
    applyTheme({ themeId: "ghost" });
    unregister();
    expect(getActiveTheme().shiki).toBe("github-light");
  });
});

describe("importThemeJson", () => {
  it("parses and registers a valid theme", () => {
    const def = importThemeJson(
      JSON.stringify({
        id: "imported",
        name: "Imported",
        mode: "light",
        light: { tokens: { "--ms-color-bg": "#123" }, shiki: "x" },
      }),
    );
    expect(def.id).toBe("imported");
    expect(getTheme("imported")).toBeDefined();
  });

  it("throws when the id is missing", () => {
    expect(() => importThemeJson(JSON.stringify({ light: { tokens: {}, shiki: "x" } }))).toThrow(
      "invalid theme json",
    );
  });

  it("throws when light.tokens is missing", () => {
    expect(() => importThemeJson(JSON.stringify({ id: "broken" }))).toThrow("invalid theme json");
  });
});
