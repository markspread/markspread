// S-KB-006/012: preset registry coverage.

import { afterEach, describe, expect, it, vi } from "vitest";

afterEach(() => vi.resetModules());

async function freshModule() {
  vi.resetModules();
  return import("../index");
}

describe("preset registry", () => {
  it("lists the built-in presets", async () => {
    const m = await freshModule();
    const ps = m.listPresets();
    expect(ps).toContain("vscode");
    expect(ps).toContain("none");
  });

  it("returns vscode entries", async () => {
    const m = await freshModule();
    const entries = m.getPresetEntries("vscode");
    expect(Array.isArray(entries)).toBe(true);
    expect((entries ?? []).length).toBeGreaterThan(0);
  });

  it("returns an empty array for 'none'", async () => {
    const m = await freshModule();
    expect(m.getPresetEntries("none")).toEqual([]);
  });

  it("returns null for an unknown preset", async () => {
    const m = await freshModule();
    expect(m.getPresetEntries("does-not-exist" as never)).toBeNull();
  });

  it("registerPluginPreset adds a new preset and tags entries as 'plugin'", async () => {
    const m = await freshModule();
    m.registerPluginPreset("sublime", [
      { commandId: "cmd.test", binding: "Mod+T", source: "preset" },
    ]);
    const entries = m.getPresetEntries("sublime");
    expect(entries?.[0]?.source).toBe("plugin");
  });
});
