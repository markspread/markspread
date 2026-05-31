// S-TST: boot wiring unit tests — enumerate installed plugins and fire
// onStartup activation, with auto-disable on failure.

import { beforeEach, describe, expect, it, vi } from "vitest";
import type { PluginManifest } from "./manifest";

const invoke = vi.fn();
vi.mock("@tauri-apps/api/core", () => ({
  invoke: (...args: unknown[]) => invoke(...args),
}));

import { bootInstalledPlugins } from "./boot";
import { getOrchestrator, resetOrchestrator } from "./runtime/orchestrator-singleton";

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
  resetOrchestrator();
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

  it("infers imported trust from an http origin and records consent", async () => {
    invoke.mockResolvedValueOnce([
      {
        manifest: manifest("ext", ["onCommand:x"]),
        enabled: false,
        origin: "https://example.com/ext.js",
      },
    ]);
    await bootInstalledPlugins();
    const orch = getOrchestrator();
    expect(orch.trust.level("ext")).toBe("imported");
    // imported → recordConsent fired at boot.
    expect(orch.trust.hasConsent("ext")).toBe(true);
  });

  it("infers imported trust from a github: origin", async () => {
    invoke.mockResolvedValueOnce([
      {
        manifest: manifest("gh", ["onCommand:x"]),
        enabled: false,
        origin: "github:owner/repo",
      },
    ]);
    await bootInstalledPlugins();
    expect(getOrchestrator().trust.level("gh")).toBe("imported");
  });

  it("treats a non-http/github origin as local (no consent step)", async () => {
    invoke.mockResolvedValueOnce([
      {
        manifest: manifest("loc", ["onCommand:x"]),
        enabled: false,
        origin: "file:///local/path",
      },
    ]);
    await bootInstalledPlugins();
    expect(getOrchestrator().trust.level("loc")).toBe("local");
  });

  it("swallows trust registration failures (downgrade attempt)", async () => {
    // Pre-register at the stricter `imported` level so a subsequent local
    // registration attempts a downgrade → TrustRegistry throws → caught + warned.
    const orch = getOrchestrator();
    orch.trust.register("dgr", "imported", { now: 0 });
    invoke.mockResolvedValueOnce([{ manifest: manifest("dgr", ["onCommand:x"]), enabled: false }]);
    await expect(bootInstalledPlugins()).resolves.toBeUndefined();
    // level stays at the stricter imported (downgrade rejected).
    expect(orch.trust.level("dgr")).toBe("imported");
  });
});
