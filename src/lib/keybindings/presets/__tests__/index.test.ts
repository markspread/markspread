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

  // M16 invariant: every preset entry must resolve to either a
  // registered host command or an explicitly whitelisted CodeMirror
  // passthrough. Otherwise the binding silently fails because the
  // dispatcher skips unknown command ids (see dispatch.ts L62).
  it("every built-in preset entry has a registered command or is a CodeMirror passthrough", async () => {
    const m = await freshModule();
    const { commands } = await import("@/lib/commands/registry");
    const { codemirrorPassthroughCommandIds } = await import("../codemirror-passthrough");

    const registered = new Set(commands.map((c) => c.id));
    const builtIns: ("vscode" | "none")[] = ["vscode", "none"];

    for (const name of builtIns) {
      const entries = m.getPresetEntries(name) ?? [];
      for (const entry of entries) {
        const ok =
          registered.has(entry.commandId) ||
          codemirrorPassthroughCommandIds.has(entry.commandId);
        expect(
          ok,
          `preset '${name}' binds '${entry.binding}' to unknown command '${entry.commandId}'; register it in src/lib/commands/registry.ts, add it to codemirror-passthrough.ts, or remove the binding`,
        ).toBe(true);
      }
    }
  });
});
