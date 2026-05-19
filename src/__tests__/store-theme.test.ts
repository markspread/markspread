// Unit tests for the theme store. The theme lib is mocked so the
// system-theme branches are deterministic and applyTheme is observable.

import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  applyTheme: vi.fn(),
  systemTheme: { value: "dark" as "light" | "dark" },
}));

vi.mock("../lib/theme", () => ({
  applyTheme: (resolved: "light" | "dark") => mocks.applyTheme(resolved),
  detectSystemTheme: () => mocks.systemTheme.value,
}));

const applyTheme = mocks.applyTheme;
const setSystemTheme = (v: "light" | "dark") => {
  mocks.systemTheme.value = v;
};

import { useTheme } from "../store/theme";

beforeEach(() => {
  applyTheme.mockClear();
  setSystemTheme("dark");
  useTheme.setState({ mode: "system", resolved: "dark" });
});

describe("theme store", () => {
  it("setMode('light') resolves to light and applies it", () => {
    useTheme.getState().setMode("light");
    expect(useTheme.getState().mode).toBe("light");
    expect(useTheme.getState().resolved).toBe("light");
    expect(applyTheme).toHaveBeenCalledWith("light");
  });

  it("setMode('dark') resolves to dark and applies it", () => {
    useTheme.getState().setMode("dark");
    expect(useTheme.getState().mode).toBe("dark");
    expect(useTheme.getState().resolved).toBe("dark");
    expect(applyTheme).toHaveBeenCalledWith("dark");
  });

  it("setMode('system') resolves through detectSystemTheme", () => {
    setSystemTheme("light");
    useTheme.getState().setMode("system");
    expect(useTheme.getState().mode).toBe("system");
    expect(useTheme.getState().resolved).toBe("light");
    expect(applyTheme).toHaveBeenCalledWith("light");
  });

  it("syncFromSystem updates resolved when mode is system", () => {
    useTheme.setState({ mode: "system", resolved: "dark" });
    setSystemTheme("light");
    useTheme.getState().syncFromSystem();
    expect(useTheme.getState().resolved).toBe("light");
    expect(applyTheme).toHaveBeenCalledWith("light");
  });

  it("syncFromSystem is a no-op when mode is not system", () => {
    useTheme.setState({ mode: "light", resolved: "light" });
    setSystemTheme("dark");
    useTheme.getState().syncFromSystem();
    expect(useTheme.getState().resolved).toBe("light");
    expect(applyTheme).not.toHaveBeenCalled();
  });
});
