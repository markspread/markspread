// S-TST: plugin lifecycle unit tests — activation parsing, signal
// matching, conflict detection, and the storage IPC wrappers.

import { beforeEach, describe, expect, it, vi } from "vitest";

const invoke = vi.fn();
vi.mock("@tauri-apps/api/core", () => ({
  invoke: (...args: unknown[]) => invoke(...args),
}));

import {
  type ContributionPoint,
  DEACTIVATE_TIMEOUT_MS,
  PLUGIN_LOG_RING_SIZE,
  PLUGIN_STORAGE_QUOTA_BYTES,
  detectConflicts,
  parseActivationEvent,
  pluginStorageGet,
  pluginStorageRemove,
  pluginStorageSet,
  shouldActivate,
} from "./lifecycle";

beforeEach(() => {
  invoke.mockReset();
});

describe("parseActivationEvent", () => {
  it("parses onStartup", () => {
    expect(parseActivationEvent("onStartup")).toEqual({ kind: "startup" });
  });

  it("parses onLanguage:<id>", () => {
    expect(parseActivationEvent("onLanguage:markdown")).toEqual({
      kind: "language",
      language: "markdown",
    });
  });

  it("parses onCommand:<id>", () => {
    expect(parseActivationEvent("onCommand:my.thing")).toEqual({
      kind: "command",
      command: "my.thing",
    });
  });

  it("parses onView:<id>", () => {
    expect(parseActivationEvent("onView:outline")).toEqual({
      kind: "view",
      view: "outline",
    });
  });

  it("returns null for unknown events", () => {
    expect(parseActivationEvent("onWhatever")).toBeNull();
    expect(parseActivationEvent("")).toBeNull();
  });
});

describe("shouldActivate", () => {
  it("matches a startup signal", () => {
    expect(shouldActivate(["onStartup"], { type: "startup" })).toBe(true);
  });

  it("matches a language signal by value", () => {
    expect(shouldActivate(["onLanguage:markdown"], { type: "language", value: "markdown" })).toBe(
      true,
    );
    expect(shouldActivate(["onLanguage:markdown"], { type: "language", value: "rust" })).toBe(
      false,
    );
  });

  it("matches a command signal by value", () => {
    expect(shouldActivate(["onCommand:do.it"], { type: "command", value: "do.it" })).toBe(true);
  });

  it("matches a view signal by value", () => {
    expect(shouldActivate(["onView:outline"], { type: "view", value: "outline" })).toBe(true);
  });

  it("ignores unparseable events", () => {
    expect(shouldActivate(["garbage", "onStartup"], { type: "startup" })).toBe(true);
  });

  it("returns false when nothing matches", () => {
    expect(shouldActivate(["onStartup"], { type: "language", value: "md" })).toBe(false);
    expect(shouldActivate([], { type: "startup" })).toBe(false);
  });
});

describe("detectConflicts", () => {
  it("returns an empty list when every point is unique", () => {
    const contributions: ContributionPoint[] = [
      { point: "commands.a", pluginId: "p1" },
      { point: "commands.b", pluginId: "p2" },
    ];
    expect(detectConflicts(contributions)).toEqual([]);
  });

  it("reports a conflict when two plugins claim the same point", () => {
    const contributions: ContributionPoint[] = [
      { point: "commands.a", pluginId: "p1" },
      { point: "commands.a", pluginId: "p2" },
      { point: "commands.b", pluginId: "p3" },
    ];
    expect(detectConflicts(contributions)).toEqual([
      { point: "commands.a", candidates: ["p1", "p2"] },
    ]);
  });

  it("handles three-way collisions", () => {
    const contributions: ContributionPoint[] = [
      { point: "x", pluginId: "p1" },
      { point: "x", pluginId: "p2" },
      { point: "x", pluginId: "p3" },
    ];
    expect(detectConflicts(contributions)).toEqual([
      { point: "x", candidates: ["p1", "p2", "p3"] },
    ]);
  });

  it("handles an empty contribution list", () => {
    expect(detectConflicts([])).toEqual([]);
  });
});

describe("storage IPC wrappers", () => {
  it("pluginStorageGet forwards to plugin_storage_get and returns the value", async () => {
    invoke.mockResolvedValueOnce("cached");
    const out = await pluginStorageGet("p1", "k");
    expect(out).toBe("cached");
    expect(invoke).toHaveBeenCalledWith("plugin_storage_get", { pluginId: "p1", key: "k" });
  });

  it("pluginStorageSet forwards to plugin_storage_set", async () => {
    invoke.mockResolvedValueOnce(undefined);
    await pluginStorageSet("p1", "k", "v");
    expect(invoke).toHaveBeenCalledWith("plugin_storage_set", {
      pluginId: "p1",
      key: "k",
      value: "v",
    });
  });

  it("pluginStorageRemove forwards to plugin_storage_remove", async () => {
    invoke.mockResolvedValueOnce(undefined);
    await pluginStorageRemove("p1", "k");
    expect(invoke).toHaveBeenCalledWith("plugin_storage_remove", {
      pluginId: "p1",
      key: "k",
    });
  });
});

describe("lifecycle constants", () => {
  it("exposes documented budgets", () => {
    expect(DEACTIVATE_TIMEOUT_MS).toBe(2_000);
    expect(PLUGIN_STORAGE_QUOTA_BYTES).toBe(5 * 1024 * 1024);
    expect(PLUGIN_LOG_RING_SIZE).toBe(1_000);
  });
});
