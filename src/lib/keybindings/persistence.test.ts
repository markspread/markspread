// S-KB-004 / S-KB-006 / S-KB-007: persistence + preset switch coverage.

import { beforeEach, describe, expect, it, vi } from "vitest";

const invoke = vi.fn<(cmd: string, args?: unknown) => Promise<unknown>>();
vi.mock("@tauri-apps/api/core", () => ({
  invoke: (cmd: string, args?: unknown) => invoke(cmd, args),
}));

const clearUserOverride = vi.fn<(...args: unknown[]) => void>();
const setUserOverride = vi.fn<(...args: unknown[]) => void>();
const switchPreset = vi.fn<(...args: unknown[]) => boolean>(() => true);
const getPreset = vi.fn<() => "vscode">(() => "vscode" as const);
const listActiveBindings = vi.fn<() => { commandId: string; binding: string; source: string }[]>(
  () => [],
);
vi.mock(".", () => ({
  clearUserOverride: (...args: unknown[]) => clearUserOverride(...args),
  setUserOverride: (...args: unknown[]) => setUserOverride(...args),
  switchPreset: (...args: unknown[]) => switchPreset(...args),
  getPreset: () => getPreset(),
  listActiveBindings: () => listActiveBindings(),
}));

import {
  changePreset,
  hydrateUserOverrides,
  persistUserOverrides,
  rebind,
  resetAllToPreset,
  resetToPreset,
  unbind,
} from "./persistence";

beforeEach(() => {
  invoke.mockReset();
  clearUserOverride.mockClear();
  setUserOverride.mockClear();
  switchPreset.mockReset();
  switchPreset.mockReturnValue(true);
  listActiveBindings.mockReset();
  listActiveBindings.mockReturnValue([]);
});

describe("hydrateUserOverrides", () => {
  it("does nothing when the backend returns null", async () => {
    invoke.mockResolvedValueOnce(null);
    await hydrateUserOverrides();
    expect(switchPreset).not.toHaveBeenCalled();
    expect(setUserOverride).not.toHaveBeenCalled();
  });

  it("does nothing when the backend returns a non-object", async () => {
    invoke.mockResolvedValueOnce("nope");
    await hydrateUserOverrides();
    expect(setUserOverride).not.toHaveBeenCalled();
  });

  it("applies the saved preset before user overrides", async () => {
    invoke.mockResolvedValueOnce({
      $preset: "sublime",
      "cmd.save": "Mod+S",
      "cmd.delete": "",
    });
    await hydrateUserOverrides();
    expect(switchPreset).toHaveBeenCalledWith("sublime");
    expect(setUserOverride).toHaveBeenCalledWith("cmd.save", "Mod+S");
    expect(setUserOverride).toHaveBeenCalledWith("cmd.delete", "");
  });

  it("skips preset switch when none is stored", async () => {
    invoke.mockResolvedValueOnce({ "cmd.save": "Mod+S" });
    await hydrateUserOverrides();
    expect(switchPreset).not.toHaveBeenCalled();
  });
});

describe("persistUserOverrides", () => {
  it("serialises the preset and user overrides", async () => {
    listActiveBindings.mockReturnValue([
      { commandId: "cmd.save", binding: "Mod+S", source: "user" },
      { commandId: "cmd.other", binding: "Mod+O", source: "preset" },
    ]);
    invoke.mockResolvedValueOnce(undefined);
    await persistUserOverrides();
    expect(invoke).toHaveBeenCalledWith("ops_keybindings_save", {
      overrides: { $preset: "vscode", "cmd.save": "Mod+S" },
    });
  });
});

describe("changePreset", () => {
  it("persists when switchPreset succeeds", async () => {
    switchPreset.mockReturnValueOnce(true);
    invoke.mockResolvedValueOnce(undefined);
    expect(await changePreset("sublime")).toBe(true);
    expect(invoke).toHaveBeenCalledWith("ops_keybindings_save", expect.any(Object));
  });

  it("does not persist when switchPreset rejects the name", async () => {
    switchPreset.mockReturnValueOnce(false);
    expect(await changePreset("nope" as never)).toBe(false);
    expect(invoke).not.toHaveBeenCalled();
  });
});

describe("rebind / unbind / resetToPreset", () => {
  it("rebind sets the override and persists", async () => {
    invoke.mockResolvedValueOnce(undefined);
    await rebind("cmd.x", "Mod+X");
    expect(setUserOverride).toHaveBeenCalledWith("cmd.x", "Mod+X");
    expect(invoke).toHaveBeenCalledWith("ops_keybindings_save", expect.any(Object));
  });

  it("unbind stores the empty-string sentinel and persists", async () => {
    invoke.mockResolvedValueOnce(undefined);
    await unbind("cmd.x");
    expect(setUserOverride).toHaveBeenCalledWith("cmd.x", "");
  });

  it("resetToPreset clears the override and persists", async () => {
    invoke.mockResolvedValueOnce(undefined);
    await resetToPreset("cmd.x");
    expect(clearUserOverride).toHaveBeenCalledWith("cmd.x");
  });
});

describe("resetAllToPreset", () => {
  it("backs up, clears every user override and returns the backup path", async () => {
    listActiveBindings.mockReturnValueOnce([
      { commandId: "cmd.a", binding: "Mod+A", source: "user" },
      { commandId: "cmd.b", binding: "Mod+B", source: "user" },
      { commandId: "cmd.c", binding: "Mod+C", source: "preset" },
    ]);
    invoke.mockResolvedValueOnce("/tmp/keybindings.json.bak").mockResolvedValueOnce(undefined);
    listActiveBindings.mockReturnValue([]); // post-clear snapshot for persist
    const r = await resetAllToPreset();
    expect(r).toBe("/tmp/keybindings.json.bak");
    expect(clearUserOverride).toHaveBeenCalledWith("cmd.a");
    expect(clearUserOverride).toHaveBeenCalledWith("cmd.b");
    expect(clearUserOverride).not.toHaveBeenCalledWith("cmd.c");
  });

  it("returns null when the backend reports no prior file to back up", async () => {
    invoke.mockResolvedValueOnce(null).mockResolvedValueOnce(undefined);
    const r = await resetAllToPreset();
    expect(r).toBeNull();
  });
});
