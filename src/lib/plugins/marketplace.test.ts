// S-TST: plugin marketplace — IPC wrappers, licence warnings, consent
// payloads, and permission deltas.

import { beforeEach, describe, expect, it, vi } from "vitest";
import type { PluginManifest, PluginPermission } from "./manifest";

const invoke = vi.fn();
vi.mock("@tauri-apps/api/core", () => ({
  invoke: (...args: unknown[]) => invoke(...args),
}));

import {
  REGISTRY_CACHE_TTL_MS,
  buildConsent,
  checkForUpdates,
  disablePlugin,
  enablePlugin,
  fetchListing,
  installPlugin,
  installVersion,
  licenceWarning,
  permissionDelta,
  searchMarketplace,
  uninstallPlugin,
} from "./marketplace";

function manifest(permissions: PluginPermission[]): PluginManifest {
  return {
    id: "demo",
    name: "Demo Plugin",
    version: "1.0.0",
    kind: "command",
    engines: { markspread: "^1.0.0" },
    activationEvents: ["onStartup"],
    permissions,
  };
}

beforeEach(() => {
  invoke.mockReset();
});

describe("IPC wrappers", () => {
  it("searchMarketplace forwards the query", async () => {
    invoke.mockResolvedValueOnce([]);
    const query = { text: "md", category: "all" as const, sort: "popular" as const };
    await searchMarketplace(query);
    expect(invoke).toHaveBeenCalledWith("plugin_marketplace_search", { query });
  });

  it("fetchListing forwards the id", async () => {
    invoke.mockResolvedValueOnce({});
    await fetchListing("demo");
    expect(invoke).toHaveBeenCalledWith("plugin_marketplace_get", { id: "demo" });
  });

  it("installPlugin forwards id + version", async () => {
    invoke.mockResolvedValueOnce({ ok: true });
    await installPlugin("demo", "1.2.3");
    expect(invoke).toHaveBeenCalledWith("plugin_install", {
      pluginId: "demo",
      version: "1.2.3",
    });
  });

  it("installVersion forwards id + version", async () => {
    invoke.mockResolvedValueOnce({ ok: true });
    await installVersion("demo", "0.9.0");
    expect(invoke).toHaveBeenCalledWith("plugin_install", {
      pluginId: "demo",
      version: "0.9.0",
    });
  });

  it("enablePlugin / disablePlugin / uninstallPlugin forward the id", async () => {
    invoke.mockResolvedValue(undefined);
    await enablePlugin("demo");
    await disablePlugin("demo");
    await uninstallPlugin("demo");
    expect(invoke).toHaveBeenCalledWith("plugin_enable", { pluginId: "demo" });
    expect(invoke).toHaveBeenCalledWith("plugin_disable", { pluginId: "demo" });
    expect(invoke).toHaveBeenCalledWith("plugin_uninstall", { pluginId: "demo" });
  });

  it("checkForUpdates forwards no arguments", async () => {
    invoke.mockResolvedValueOnce([]);
    await checkForUpdates();
    expect(invoke).toHaveBeenCalledWith("plugin_marketplace_updates");
  });
});

describe("licenceWarning", () => {
  it("warns when no licence is declared", () => {
    expect(licenceWarning(null)).toContain("no licence");
  });

  it("returns null for safe-by-default licences", () => {
    expect(licenceWarning("MIT")).toBeNull();
    expect(licenceWarning("Apache-2.0")).toBeNull();
    expect(licenceWarning("ISC")).toBeNull();
  });

  it("flags GPL-style copy-left licences", () => {
    expect(licenceWarning("GPL-3.0")).toContain("copy-left");
    expect(licenceWarning("gpl-2.0")).toContain("copy-left");
  });

  it("flags an unfamiliar licence", () => {
    expect(licenceWarning("WTFPL")).toContain("unfamiliar");
  });
});

describe("buildConsent", () => {
  it("renders permission lines and clears warnings when benign", () => {
    const consent = buildConsent(manifest(["fs.workspace-read"]));
    expect(consent.pluginId).toBe("demo");
    expect(consent.pluginName).toBe("Demo Plugin");
    expect(consent.permissionLines).toHaveLength(1);
    expect(consent.networkWildcard).toBe(false);
    expect(consent.fsOutside).toBe(false);
  });

  it("flags the network wildcard", () => {
    const consent = buildConsent(manifest([{ network: ["*"] }]));
    expect(consent.networkWildcard).toBe(true);
  });

  it("flags fs.outside", () => {
    const consent = buildConsent(manifest(["fs.outside"]));
    expect(consent.fsOutside).toBe(true);
  });
});

describe("permissionDelta", () => {
  it("returns an empty list when no new permissions appear", () => {
    expect(permissionDelta(["fs.workspace-read"], ["fs.workspace-read"])).toEqual([]);
  });

  it("reports newly added string permissions", () => {
    expect(permissionDelta(["fs.workspace-read"], ["fs.workspace-read", "fs.outside"])).toEqual([
      "fs.outside",
    ]);
  });

  it("reports newly added object permissions", () => {
    const delta = permissionDelta([], [{ network: ["api.com"] }]);
    expect(delta).toEqual([{ network: ["api.com"] }]);
  });

  it("treats structurally identical object permissions as unchanged", () => {
    expect(permissionDelta([{ network: ["api.com"] }], [{ network: ["api.com"] }])).toEqual([]);
  });
});

describe("marketplace constants", () => {
  it("REGISTRY_CACHE_TTL_MS is one hour", () => {
    expect(REGISTRY_CACHE_TTL_MS).toBe(60 * 60 * 1000);
  });
});
