// S-TST: host-API permission gate — manifest checks, hostname matching,
// the gateHostApi funnel, and describePermission strings.

import { beforeEach, describe, expect, it, vi } from "vitest";
import type { PluginManifest, PluginPermission } from "./manifest";
import type { HostApi } from "./permissions";

const invoke = vi.fn();
vi.mock("@tauri-apps/api/core", () => ({
  invoke: (...args: unknown[]) => invoke(...args),
}));

import { checkAgainstManifest, describePermission, gateHostApi, matchHost } from "./permissions";

function manifest(permissions: PluginPermission[]): PluginManifest {
  return {
    id: "p",
    name: "P",
    version: "1.0.0",
    kind: "ai",
    engines: { markspread: "^1.0.0" },
    activationEvents: ["onStartup"],
    permissions,
  };
}

beforeEach(() => {
  invoke.mockReset();
  invoke.mockResolvedValue(undefined);
});

describe("checkAgainstManifest", () => {
  it("fs.workspace.read allowed by read or write permission", () => {
    expect(
      checkAgainstManifest(
        { kind: "fs.workspace.read", path: "/a" },
        manifest(["fs.workspace-read"]),
      ),
    ).toBe("allow");
    expect(
      checkAgainstManifest(
        { kind: "fs.workspace.read", path: "/a" },
        manifest(["fs.workspace-write"]),
      ),
    ).toBe("allow");
    expect(checkAgainstManifest({ kind: "fs.workspace.read", path: "/a" }, manifest([]))).toBe(
      "deny",
    );
  });

  it("fs.workspace.write requires the write permission", () => {
    expect(
      checkAgainstManifest(
        { kind: "fs.workspace.write", path: "/a", bytes: 1 },
        manifest(["fs.workspace-write"]),
      ),
    ).toBe("allow");
    expect(
      checkAgainstManifest(
        { kind: "fs.workspace.write", path: "/a", bytes: 1 },
        manifest(["fs.workspace-read"]),
      ),
    ).toBe("deny");
  });

  it("fs.outside requires a per-call prompt when granted, deny otherwise", () => {
    expect(
      checkAgainstManifest({ kind: "fs.outside.read", path: "/x" }, manifest(["fs.outside"])),
    ).toBe("prompt");
    expect(
      checkAgainstManifest(
        { kind: "fs.outside.write", path: "/x", bytes: 1 },
        manifest(["fs.outside"]),
      ),
    ).toBe("prompt");
    expect(checkAgainstManifest({ kind: "fs.outside.read", path: "/x" }, manifest([]))).toBe(
      "deny",
    );
  });

  it("network checks the host against the allow-list", () => {
    const m = manifest([{ network: ["api.example.com", "*.cdn.net"] }]);
    expect(checkAgainstManifest({ kind: "network", url: "https://api.example.com/x" }, m)).toBe(
      "allow",
    );
    expect(checkAgainstManifest({ kind: "network", url: "https://a.cdn.net/x" }, m)).toBe("allow");
    expect(checkAgainstManifest({ kind: "network", url: "https://evil.com" }, m)).toBe("deny");
  });

  it("network denies when there is no network permission", () => {
    expect(checkAgainstManifest({ kind: "network", url: "https://x.com" }, manifest([]))).toBe(
      "deny",
    );
  });

  it("network denies a malformed URL", () => {
    expect(
      checkAgainstManifest({ kind: "network", url: "not a url" }, manifest([{ network: ["*"] }])),
    ).toBe("deny");
  });

  it("keychain.resolve checks the alias allow-list", () => {
    const m = manifest([{ keychain: ["openai"] }]);
    expect(checkAgainstManifest({ kind: "keychain.resolve", alias: "openai" }, m)).toBe("allow");
    expect(checkAgainstManifest({ kind: "keychain.resolve", alias: "other" }, m)).toBe("deny");
    expect(checkAgainstManifest({ kind: "keychain.resolve", alias: "openai" }, manifest([]))).toBe(
      "deny",
    );
  });

  it("shell is hard-denied regardless of manifest", () => {
    expect(checkAgainstManifest({ kind: "shell", command: "ls" }, manifest(["shell"]))).toBe(
      "deny",
    );
  });
});

describe("matchHost", () => {
  it("matches a bare hostname exactly", () => {
    expect(matchHost("example.com", "example.com")).toBe(true);
    expect(matchHost("api.example.com", "example.com")).toBe(false);
  });

  it("matches a wildcard against subdomains only", () => {
    expect(matchHost("api.example.com", "*.example.com")).toBe(true);
    expect(matchHost("example.com", "*.example.com")).toBe(false);
  });

  it("accepts a list of patterns", () => {
    expect(matchHost("api.example.com", ["other.com", "*.example.com"])).toBe(true);
    expect(matchHost("nope.com", ["other.com", "*.example.com"])).toBe(false);
  });
});

describe("gateHostApi", () => {
  const api: HostApi = { kind: "fs.workspace.read", path: "/a" };

  it("allows a manifest-granted call and records the decision", async () => {
    const decision = await gateHostApi("p", manifest(["fs.workspace-read"]), api);
    expect(decision.allow).toBe(true);
    expect(decision.reason).toBe("granted by manifest");
    expect(invoke).toHaveBeenCalledWith(
      "plugin_permission_audit",
      expect.objectContaining({ entry: expect.objectContaining({ decision: "allow" }) }),
    );
  });

  it("denies a manifest-forbidden call", async () => {
    const decision = await gateHostApi("p", manifest([]), api);
    expect(decision.allow).toBe(false);
    expect(decision.reason).toContain("manifest does not grant");
  });

  it("fails closed on a prompt call when no resolver is supplied", async () => {
    const decision = await gateHostApi("p", manifest(["fs.outside"]), {
      kind: "fs.outside.read",
      path: "/x",
    });
    expect(decision.allow).toBe(false);
  });

  it("honours an approving consent resolver", async () => {
    const resolver = vi.fn().mockResolvedValue(true);
    const decision = await gateHostApi(
      "p",
      manifest(["fs.outside"]),
      { kind: "fs.outside.read", path: "/x" },
      resolver,
    );
    expect(decision.allow).toBe(true);
    expect(resolver).toHaveBeenCalled();
    expect(invoke).toHaveBeenCalledWith("plugin_permission_prompt", {
      pluginId: "p",
      granted: true,
    });
  });

  it("honours a declining consent resolver", async () => {
    const resolver = vi.fn().mockResolvedValue(false);
    const decision = await gateHostApi(
      "p",
      manifest(["fs.outside"]),
      { kind: "fs.outside.write", path: "/x", bytes: 8 },
      resolver,
    );
    expect(decision.allow).toBe(false);
    expect(decision.reason).toBe("user declined this call");
  });
});

describe("describePermission", () => {
  it("describes each string permission", () => {
    expect(describePermission("fs.workspace-read")).toContain("Read files");
    expect(describePermission("fs.workspace-write")).toContain("write");
    expect(describePermission("fs.outside")).toContain("outside");
    expect(describePermission("shell")).toContain("blocked");
  });

  it("describes network and keychain object permissions", () => {
    expect(describePermission({ network: ["a.com", "b.com"] })).toContain("a.com, b.com");
    expect(describePermission({ keychain: ["openai"] })).toContain("openai");
  });
});
