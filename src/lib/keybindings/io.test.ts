// S-KB-011: import / export user keybinding overrides coverage.

import { beforeEach, describe, expect, it, vi } from "vitest";

const openDialog = vi.fn();
const saveDialog = vi.fn();
vi.mock("@tauri-apps/plugin-dialog", () => ({
  open: (...args: unknown[]) => openDialog(...args),
  save: (...args: unknown[]) => saveDialog(...args),
}));

const readTextFile = vi.fn();
const writeTextFile = vi.fn();
vi.mock("@tauri-apps/plugin-fs", () => ({
  readTextFile: (...args: unknown[]) => readTextFile(...args),
  writeTextFile: (...args: unknown[]) => writeTextFile(...args),
}));

const clearUserOverride = vi.fn();
const setUserOverride = vi.fn();
const listActiveBindings = vi.fn<() => { commandId: string; binding: string; source: string }[]>();
vi.mock(".", () => ({
  clearUserOverride: (...args: unknown[]) => clearUserOverride(...args),
  setUserOverride: (...args: unknown[]) => setUserOverride(...args),
  listActiveBindings: () => listActiveBindings(),
}));

const persistUserOverrides = vi.fn(() => Promise.resolve());
vi.mock("./persistence", () => ({
  persistUserOverrides: () => persistUserOverrides(),
}));

import { exportKeybindings, importKeybindings } from "./io";

beforeEach(() => {
  openDialog.mockReset();
  saveDialog.mockReset();
  readTextFile.mockReset();
  writeTextFile.mockReset();
  clearUserOverride.mockClear();
  setUserOverride.mockClear();
  listActiveBindings.mockReset();
  listActiveBindings.mockReturnValue([]);
  persistUserOverrides.mockClear();
});

describe("exportKeybindings", () => {
  it("returns null when the user cancels the save dialog", async () => {
    saveDialog.mockResolvedValueOnce(null);
    expect(await exportKeybindings()).toBeNull();
    expect(writeTextFile).not.toHaveBeenCalled();
  });

  it("writes only user overrides to the chosen path", async () => {
    saveDialog.mockResolvedValueOnce("/tmp/kb.json");
    listActiveBindings.mockReturnValueOnce([
      { commandId: "cmd.save", binding: "Mod+S", source: "user" },
      { commandId: "cmd.other", binding: "Mod+O", source: "preset" },
    ]);
    writeTextFile.mockResolvedValueOnce(undefined);
    const r = await exportKeybindings();
    expect(r).toBe("/tmp/kb.json");
    const [path, body] = writeTextFile.mock.calls[0] ?? [];
    expect(path).toBe("/tmp/kb.json");
    expect(JSON.parse(body as string)).toEqual({
      $schema: "https://markspread.app/schemas/keybindings.json",
      bindings: { "cmd.save": "Mod+S" },
    });
  });
});

describe("importKeybindings", () => {
  it("returns null when the user cancels the open dialog", async () => {
    openDialog.mockResolvedValueOnce(null);
    expect(await importKeybindings()).toBeNull();
  });

  it("returns null when the dialog yields an array (multi-select fallback)", async () => {
    openDialog.mockResolvedValueOnce([]);
    expect(await importKeybindings()).toBeNull();
  });

  it("throws on invalid JSON", async () => {
    openDialog.mockResolvedValueOnce("/tmp/x");
    readTextFile.mockResolvedValueOnce("not-json");
    await expect(importKeybindings()).rejects.toThrow(/Invalid JSON/);
  });

  it("stringifies non-Error throws from JSON.parse", async () => {
    openDialog.mockResolvedValueOnce("/tmp/x");
    readTextFile.mockResolvedValueOnce("anything");
    const orig = JSON.parse;
    JSON.parse = (() => {
      throw "weird";
    }) as typeof JSON.parse;
    try {
      await expect(importKeybindings()).rejects.toThrow(/Invalid JSON: weird/);
    } finally {
      JSON.parse = orig;
    }
  });

  it("throws when the file lacks a bindings shape", async () => {
    openDialog.mockResolvedValueOnce("/tmp/x");
    readTextFile.mockResolvedValueOnce("123");
    await expect(importKeybindings()).rejects.toThrow(/not a Markspread keybindings export/);
  });

  it("throws when a binding value is not a string", async () => {
    openDialog.mockResolvedValueOnce("/tmp/x");
    readTextFile.mockResolvedValueOnce(JSON.stringify({ "cmd.x": 42 }));
    await expect(importKeybindings()).rejects.toThrow(/not a Markspread keybindings export/);
  });

  it("merges by default, recording conflicts and applying everything", async () => {
    openDialog.mockResolvedValueOnce("/tmp/x");
    readTextFile.mockResolvedValueOnce(
      JSON.stringify({
        $schema: "ignored",
        bindings: { "cmd.save": "Mod+Alt+S", "cmd.new": "Mod+N" },
      }),
    );
    listActiveBindings.mockReturnValueOnce([
      { commandId: "cmd.save", binding: "Mod+S", source: "user" },
      { commandId: "cmd.preset", binding: "Mod+P", source: "preset" },
    ]);
    const r = await importKeybindings();
    expect(r).toEqual({
      applied: 2,
      skipped: 0,
      conflicts: [{ commandId: "cmd.save", existing: "Mod+S", incoming: "Mod+Alt+S" }],
    });
    expect(setUserOverride).toHaveBeenCalledWith("cmd.save", "Mod+Alt+S");
    expect(setUserOverride).toHaveBeenCalledWith("cmd.new", "Mod+N");
    expect(clearUserOverride).not.toHaveBeenCalled();
    expect(persistUserOverrides).toHaveBeenCalled();
  });

  it("replace mode clears existing user overrides first", async () => {
    openDialog.mockResolvedValueOnce("/tmp/x");
    readTextFile.mockResolvedValueOnce(JSON.stringify({ "cmd.new": "Mod+N" }));
    listActiveBindings.mockReturnValueOnce([
      { commandId: "cmd.save", binding: "Mod+S", source: "user" },
      { commandId: "cmd.other", binding: "Mod+O", source: "user" },
    ]);
    await importKeybindings("replace");
    expect(clearUserOverride).toHaveBeenCalledWith("cmd.save");
    expect(clearUserOverride).toHaveBeenCalledWith("cmd.other");
  });

  it("accepts a flat object shape (no top-level 'bindings' key)", async () => {
    openDialog.mockResolvedValueOnce("/tmp/x");
    readTextFile.mockResolvedValueOnce(JSON.stringify({ $schema: "ignored", "cmd.new": "Mod+N" }));
    const r = await importKeybindings();
    expect(r?.applied).toBe(1);
    expect(setUserOverride).toHaveBeenCalledWith("cmd.new", "Mod+N");
  });
});
