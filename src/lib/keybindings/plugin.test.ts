// S-KB-012: plugin keybinding contribution surface.

import { describe, expect, it, vi } from "vitest";

const registerPluginKeybindings = vi.fn();
const unregisterPluginKeybindings = vi.fn();
vi.mock(".", () => ({
  registerPluginKeybindings: (...args: unknown[]) => registerPluginKeybindings(...args),
  unregisterPluginKeybindings: (...args: unknown[]) => unregisterPluginKeybindings(...args),
}));

import { applyPluginManifestKeybindings, extractManifestKeybindings } from "./plugin";

describe("applyPluginManifestKeybindings", () => {
  it("unregisters when entries is null", () => {
    applyPluginManifestKeybindings("plug.a", null);
    expect(unregisterPluginKeybindings).toHaveBeenCalledWith("plug.a");
    expect(registerPluginKeybindings).not.toHaveBeenCalled();
  });

  it("unregisters when entries is undefined", () => {
    unregisterPluginKeybindings.mockClear();
    applyPluginManifestKeybindings("plug.b", undefined);
    expect(unregisterPluginKeybindings).toHaveBeenCalledWith("plug.b");
  });

  it("unregisters when entries is empty", () => {
    unregisterPluginKeybindings.mockClear();
    applyPluginManifestKeybindings("plug.c", []);
    expect(unregisterPluginKeybindings).toHaveBeenCalledWith("plug.c");
  });

  it("registers the entries when present", () => {
    registerPluginKeybindings.mockClear();
    applyPluginManifestKeybindings("plug.d", [{ command: "x", key: "Mod+X" }]);
    expect(registerPluginKeybindings).toHaveBeenCalledWith("plug.d", [
      { commandId: "x", binding: "Mod+X" },
    ]);
  });
});

describe("extractManifestKeybindings", () => {
  it("returns an empty array when contributes is missing", () => {
    expect(extractManifestKeybindings(undefined)).toEqual([]);
  });

  it("returns an empty array when keybindings is not an array", () => {
    expect(extractManifestKeybindings({ keybindings: "nope" })).toEqual([]);
  });

  it("skips entries that are not objects", () => {
    expect(extractManifestKeybindings({ keybindings: [null, 1, "x"] })).toEqual([]);
  });

  it("skips entries missing command or key string", () => {
    expect(
      extractManifestKeybindings({
        keybindings: [{ command: 1, key: "Mod+X" }, { command: "x", key: 2 }, {}],
      }),
    ).toEqual([]);
  });

  it("extracts valid command/key pairs", () => {
    expect(
      extractManifestKeybindings({
        keybindings: [
          { command: "a", key: "Mod+A" },
          { command: "b", key: "Mod+B" },
        ],
      }),
    ).toEqual([
      { command: "a", key: "Mod+A" },
      { command: "b", key: "Mod+B" },
    ]);
  });
});
