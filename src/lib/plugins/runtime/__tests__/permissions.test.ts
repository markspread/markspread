// S-PL-SEC-001: permission gating + grant persistence regression tests.

import { describe, expect, it, vi } from "vitest";
import {
  createMemoryGrantStore,
  evaluatePermission,
  extractHost,
  gatePermission,
  isHostAllowed,
} from "../permissions";
import type { GrantedPermissions, PluginManifest } from "../types";

const baseManifest = (): PluginManifest => ({
  schemaVersion: 1,
  name: "wireweave",
  version: "0.3.1",
  entry: "./index.js",
  permissions: [],
  allowedHosts: [],
  contributes: {},
  render: "html",
  engines: { markspread: ">=1.3.0" },
});

describe("evaluatePermission", () => {
  it("denies when manifest does not declare the permission", () => {
    const v = evaluatePermission(baseManifest(), "network", null);
    expect(v.decision).toBe("deny");
  });

  it("allows when grant matches version + permission", () => {
    const m = { ...baseManifest(), permissions: ["network" as const] };
    const grant: GrantedPermissions = {
      grantedAt: 1,
      version: "0.3.1",
      permissions: ["network"],
    };
    expect(evaluatePermission(m, "network", grant).decision).toBe("allow");
  });

  it("prompts when manifest declares but no grant", () => {
    const m = { ...baseManifest(), permissions: ["fs:read" as const] };
    expect(evaluatePermission(m, "fs:read", null).decision).toBe("prompt");
  });

  it("prompts when grant version is stale (R4)", () => {
    const m = { ...baseManifest(), permissions: ["fs:read" as const] };
    const stale: GrantedPermissions = {
      grantedAt: 1,
      version: "0.2.0",
      permissions: ["fs:read"],
    };
    expect(evaluatePermission(m, "fs:read", stale).decision).toBe("prompt");
  });
});

describe("isHostAllowed", () => {
  it("exact match", () => {
    expect(isHostAllowed("api.example.com", ["api.example.com"])).toBe(true);
  });
  it("wildcard subdomain match", () => {
    expect(isHostAllowed("api.example.com", ["*.example.com"])).toBe(true);
  });
  it("wildcard does not match exact suffix", () => {
    expect(isHostAllowed("example.com", ["*.example.com"])).toBe(false);
  });
  it("case-insensitive", () => {
    expect(isHostAllowed("API.example.COM", ["api.example.com"])).toBe(true);
  });
  it("returns false for empty list", () => {
    expect(isHostAllowed("any.com", [])).toBe(false);
  });
});

describe("extractHost", () => {
  it("returns host for valid URL", () => {
    expect(extractHost("https://API.Example.com/path")).toBe("api.example.com");
  });
  it("returns null for invalid URL", () => {
    expect(extractHost("not a url")).toBe(null);
  });
});

describe("gatePermission", () => {
  it("denies immediately when manifest does not declare", async () => {
    const m = baseManifest();
    const store = createMemoryGrantStore();
    const resolver = vi.fn(async () => true);
    const v = await gatePermission(m, "network", store, resolver);
    expect(v.decision).toBe("deny");
    expect(resolver).not.toHaveBeenCalled();
  });

  it("allows when previously granted (always)", async () => {
    const m = { ...baseManifest(), permissions: ["fs:read" as const] };
    const store = createMemoryGrantStore();
    await store.write("wireweave", {
      grantedAt: 1,
      version: "0.3.1",
      permissions: ["fs:read"],
    });
    const v = await gatePermission(m, "fs:read", store, async () => false);
    expect(v.decision).toBe("allow");
  });

  it("persists 'always' grant", async () => {
    const m = { ...baseManifest(), permissions: ["fs:read" as const] };
    const store = createMemoryGrantStore();
    const v = await gatePermission(
      m,
      "fs:read",
      store,
      async (_n, _p, scope) => scope === "always",
    );
    expect(v.decision).toBe("allow");
    const stored = await store.read("wireweave");
    expect(stored?.permissions).toContain("fs:read");
  });

  it("supports 'once' approval without persisting", async () => {
    const m = { ...baseManifest(), permissions: ["fs:read" as const] };
    const store = createMemoryGrantStore();
    const v = await gatePermission(m, "fs:read", store, async (_n, _p, scope) => scope === "once");
    expect(v.decision).toBe("allow");
    expect(await store.read("wireweave")).toBe(null);
  });

  it("denies when user declines both scopes", async () => {
    const m = { ...baseManifest(), permissions: ["fs:read" as const] };
    const store = createMemoryGrantStore();
    const v = await gatePermission(m, "fs:read", store, async () => false);
    expect(v.decision).toBe("deny");
  });

  it("merges into existing grant on 'always'", async () => {
    const m = {
      ...baseManifest(),
      permissions: ["fs:read" as const, "fs:write" as const],
    };
    const store = createMemoryGrantStore();
    await store.write("wireweave", {
      grantedAt: 1,
      version: "0.3.1",
      permissions: ["fs:read"],
    });
    await gatePermission(m, "fs:write", store, async (_n, _p, s) => s === "always");
    const stored = await store.read("wireweave");
    expect(stored?.permissions.sort()).toEqual(["fs:read", "fs:write"]);
  });
});
