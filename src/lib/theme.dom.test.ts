// theme detection + DOM application.

import { afterEach, describe, expect, it, vi } from "vitest";
import { applyTheme, detectSystemTheme } from "./theme";

afterEach(() => {
  vi.unstubAllGlobals();
  delete document.documentElement.dataset.theme;
  document.documentElement.style.colorScheme = "";
});

describe("detectSystemTheme", () => {
  it("returns dark when prefers-color-scheme:dark matches", () => {
    vi.stubGlobal("matchMedia", vi.fn().mockReturnValue({ matches: true }));
    expect(detectSystemTheme()).toBe("dark");
  });

  it("returns light when the media query does not match", () => {
    vi.stubGlobal("matchMedia", vi.fn().mockReturnValue({ matches: false }));
    expect(detectSystemTheme()).toBe("light");
  });

  it("returns light when matchMedia is unavailable", () => {
    vi.stubGlobal("matchMedia", undefined);
    expect(detectSystemTheme()).toBe("light");
  });
});

describe("applyTheme", () => {
  it("sets the theme dataset and colorScheme for dark", () => {
    applyTheme("dark");
    expect(document.documentElement.dataset.theme).toBe("dark");
    expect(document.documentElement.style.colorScheme).toBe("dark");
  });

  it("sets the theme dataset and colorScheme for light", () => {
    applyTheme("light");
    expect(document.documentElement.dataset.theme).toBe("light");
    expect(document.documentElement.style.colorScheme).toBe("light");
  });
});
