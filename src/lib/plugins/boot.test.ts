// S-TST: boot wiring unit tests — enumerate installed plugins and fire
// onStartup activation, with auto-disable on failure.

import { beforeEach, describe, expect, it, vi } from "vitest";
import type { PluginManifest } from "./manifest";

const invoke = vi.fn();
vi.mock("@tauri-apps/api/core", () => ({
  invoke: (...args: unknown[]) => invoke(...args),
}));

import { bootInstalledPlugins } from "./boot";

function manifest(id: string, activationEvents: string[]): PluginManifest {
  return {
    id,
    name: id,
    version: "1.0.0",
    kind: "command",
    engines: { markspread: "^1.0.0" },
    activationEvents,
    permissions: [],
  };
}

beforeEach(() => {
  invoke.mockReset();
});

describe("bootInstalledPlugins", () => {
  it("returns quietly when plugin_list is unavailable", async () => {
    invoke.mockRejectedValueOnce(new Error("no handler"));
    await expect(bootInstalledPlugins()).resolves.toBeUndefined();
    expect(invoke).toHaveBeenCalledTimes(1);
  });

  it("activates enabled plugins that opt into startup", async () => {
    invoke.mockResolvedValueOnce([{ manifest: manifest("a", ["onStartup"]), enabled: true }]);
    invoke.mockResolvedValueOnce(undefined); // plugin_activate
    await bootInstalledPlugins();
    expect(invoke).toHaveBeenCalledWith("plugin_activate", { pluginId: "a" });
  });

  it("skips disabled plugins", async () => {
    invoke.mockResolvedValueOnce([{ manifest: manifest("a", ["onStartup"]), enabled: false }]);
    await bootInstalledPlugins();
    expect(invoke).toHaveBeenCalledTimes(1);
  });

  it("skips plugins without an onStartup activation event", async () => {
    invoke.mockResolvedValueOnce([{ manifest: manifest("a", ["onCommand:x"]), enabled: true }]);
    await bootInstalledPlugins();
    expect(invoke).toHaveBeenCalledTimes(1);
  });

  it("auto-disables a plugin when activation fails", async () => {
    invoke.mockResolvedValueOnce([{ manifest: manifest("bad", ["onStartup"]), enabled: true }]);
    invoke.mockRejectedValueOnce(new Error("boom")); // plugin_activate
    invoke.mockResolvedValueOnce(undefined); // plugin_disable
    await bootInstalledPlugins();
    expect(invoke).toHaveBeenCalledWith("plugin_disable", { pluginId: "bad" });
  });

  it("swallows errors from the auto-disable attempt", async () => {
    invoke.mockResolvedValueOnce([{ manifest: manifest("bad", ["onStartup"]), enabled: true }]);
    invoke.mockRejectedValueOnce(new Error("activate failed"));
    invoke.mockRejectedValueOnce(new Error("disable failed"));
    await expect(bootInstalledPlugins()).resolves.toBeUndefined();
  });

  it("handles an empty plugin list", async () => {
    invoke.mockResolvedValueOnce([]);
    await bootInstalledPlugins();
    expect(invoke).toHaveBeenCalledTimes(1);
  });
});
