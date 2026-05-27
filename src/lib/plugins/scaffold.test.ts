// S-PL-SEC-001 (MAR-1019): scaffold + validator behaviour.

import { afterEach, describe, expect, it, vi } from "vitest";

const invoke = vi.fn();
vi.mock("@tauri-apps/api/core", () => ({
  invoke: (...args: unknown[]) => invoke(...(args as Parameters<typeof invoke>)),
}));

import { PluginHost } from "./runtime/host";
import { type Message, type WorkerLike, createFakeWorkerPair } from "./runtime/sandbox-rpc";
import type { PluginManifest } from "./runtime/types";
import { installScaffold, scaffoldAndValidate, scaffoldPlugin, validateManifest } from "./scaffold";
import { buildIndexJs, buildManifest, buildReadme } from "./scaffold/templates";

afterEach(() => {
  invoke.mockReset();
});

function fakeReadyFactory() {
  return () => {
    const { hostSide, pluginSide } = createFakeWorkerPair();
    pluginSide.addEventListener("message", (ev) => {
      const m = ev.data as Message;
      if (m.type === "host:init") {
        pluginSide.postMessage({
          type: "plugin:ready",
          registered: [{ kind: "codeblock", key: "mermaid" }],
        });
      }
    });
    return hostSide as WorkerLike;
  };
}

describe("scaffoldPlugin templates", () => {
  it("generates codeblock manifest + index.js + README", () => {
    const { files } = scaffoldPlugin({
      name: "demo",
      kind: "codeblock",
      key: "demo",
      hint: "A demo plugin.",
    });
    const manifest = JSON.parse(files["markspread-plugin.json"]);
    expect(manifest.contributes.codeblocks.demo).toEqual({ render: "html" });
    expect(manifest.description).toBe("A demo plugin.");
    expect(files["index.js"]).toContain('m.kind === "codeblock"');
    expect(files["README.md"]).toContain("```demo");
  });

  it("generates fence manifest + index.js with fence dispatch", () => {
    const { files } = scaffoldPlugin({
      name: "callouts",
      kind: "fence",
      key: "tip",
    });
    const manifest = JSON.parse(files["markspread-plugin.json"]);
    expect(manifest.contributes.fences).toEqual([{ name: "tip", render: "html" }]);
    expect(manifest.description).toContain("Scaffolded fence");
    expect(files["index.js"]).toContain('m.kind === "fence"');
    expect(files["README.md"]).toContain(":::tip");
  });

  it("honours explicit version and permissions + allowedHosts", () => {
    const json = buildManifest({
      name: "x",
      kind: "codeblock",
      key: "x",
      version: "1.2.3",
      permissions: ["network"],
      allowedHosts: ["api.example.com"],
      render: "html",
    });
    const m = JSON.parse(json);
    expect(m.version).toBe("1.2.3");
    expect(m.permissions).toEqual(["network"]);
    expect(m.allowedHosts).toEqual(["api.example.com"]);
  });

  it("buildIndexJs and buildReadme emit valid strings for fence spec", () => {
    const indexJs = buildIndexJs({ name: "f", kind: "fence", key: "note" });
    const readme = buildReadme({ name: "f", kind: "fence", key: "note" });
    expect(indexJs).toContain("self.addEventListener");
    expect(readme).toContain("# f");
    expect(readme).toContain("None (pure transform");
  });

  it("README lists declared permissions when present", () => {
    const readme = buildReadme({
      name: "p",
      kind: "codeblock",
      key: "p",
      permissions: ["network"],
      allowedHosts: ["api.example.com"],
    });
    expect(readme).toContain("network");
    expect(readme).not.toContain("None (pure transform");
  });

  it("scaffoldAndValidate returns ok for default codeblock spec", () => {
    const { validation } = scaffoldAndValidate({
      name: "ok",
      kind: "codeblock",
      key: "ok",
    });
    expect(validation.ok).toBe(true);
  });
});

describe("validateManifest", () => {
  it("decorates name/version errors with hints", () => {
    const r = validateManifest({
      schemaVersion: 1,
      name: "UPPER",
      version: "not-semver",
      entry: "./index.js",
      permissions: [],
      allowedHosts: [],
      contributes: {},
      render: "html",
      engines: { markspread: ">=1.3.0" },
    });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    const paths = r.errors.map((e) => e.path);
    expect(paths).toContain("name");
    expect(paths).toContain("version");
    expect(r.errors.find((e) => e.path === "name")?.hint).toContain("lowercase");
    expect(r.errors.find((e) => e.path === "version")?.hint).toContain("SemVer");
  });

  it("decorates allowedHosts error with hint when network permission set", () => {
    const r = validateManifest({
      schemaVersion: 1,
      name: "ok-name",
      version: "0.1.0",
      entry: "./index.js",
      permissions: ["network"],
      allowedHosts: [],
      contributes: { fences: [{ name: "x", render: "html" }] },
      render: "html",
      engines: { markspread: ">=1.3.0" },
    });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.errors.find((e) => e.path === "allowedHosts")?.hint).toContain("network");
  });

  it("reports JSON parse error with $ path + hint", () => {
    const r = validateManifest("{ not json");
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.errors[0]?.path).toBe("$");
    expect(r.errors[0]?.hint).toContain("JSON");
  });

  it("leaves non-decorated errors (e.g. missing engines) unchanged", () => {
    const r = validateManifest({
      schemaVersion: 1,
      name: "ok-name",
      version: "0.1.0",
      entry: "./index.js",
      permissions: [],
      allowedHosts: [],
      contributes: { fences: [{ name: "x", render: "html" }] },
      render: "html",
      // engines omitted → schema error on `engines`.
    });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    const engineErr = r.errors.find((e) => e.path === "engines");
    expect(engineErr).toBeTruthy();
    expect(engineErr?.hint).toBeUndefined();
  });

  it("decorates entry traversal error", () => {
    const r = validateManifest(
      JSON.stringify({
        schemaVersion: 1,
        name: "ok-name",
        version: "0.1.0",
        entry: "../escape.js",
        permissions: [],
        allowedHosts: [],
        contributes: { fences: [{ name: "x", render: "html" }] },
        render: "html",
        engines: { markspread: ">=1.3.0" },
      }),
    );
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.errors.find((e) => e.path === "entry")?.hint).toContain("relative");
  });

  it("returns ok + warnings when contributions empty", () => {
    const r = validateManifest({
      schemaVersion: 1,
      name: "empty",
      version: "0.1.0",
      entry: "./index.js",
      permissions: [],
      allowedHosts: [],
      contributes: {},
      render: "html",
      engines: { markspread: ">=1.3.0" },
    });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.warnings.find((w) => w.path === "contributes")).toBeTruthy();
    expect(r.warnings.find((w) => w.path === "description")).toBeTruthy();
  });

  it("warns when allowedHosts is set without network permission", () => {
    const r = validateManifest({
      schemaVersion: 1,
      name: "warnme",
      version: "0.1.0",
      entry: "./index.js",
      description: "warn-only manifest",
      permissions: [],
      allowedHosts: ["api.example.com"],
      contributes: { fences: [{ name: "x", render: "html" }] },
      render: "html",
      engines: { markspread: ">=1.3.0" },
    });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.warnings.find((w) => w.path === "allowedHosts")).toBeTruthy();
  });

  it("treats headers and inlineRules as valid contributions for hasAnything", () => {
    const headers = validateManifest({
      schemaVersion: 1,
      name: "h",
      version: "0.1.0",
      entry: "./index.js",
      description: "headers only",
      permissions: [],
      allowedHosts: [],
      contributes: { headers: { h2: { render: "html" } } },
      render: "html",
      engines: { markspread: ">=1.3.0" },
    });
    expect(headers.ok).toBe(true);
    if (!headers.ok) return;
    expect(headers.warnings.find((w) => w.path === "contributes")).toBeUndefined();

    const inline = validateManifest({
      schemaVersion: 1,
      name: "i",
      version: "0.1.0",
      entry: "./index.js",
      description: "inline only",
      permissions: [],
      allowedHosts: [],
      contributes: { inlineRules: [{ pattern: "@\\w+", render: "html" }] },
      render: "html",
      engines: { markspread: ">=1.3.0" },
    });
    expect(inline.ok).toBe(true);
    if (!inline.ok) return;
    expect(inline.warnings.find((w) => w.path === "contributes")).toBeUndefined();
  });

  it("passes a fully populated manifest with no warnings", () => {
    const r = validateManifest({
      schemaVersion: 1,
      name: "full",
      version: "0.1.0",
      entry: "./index.js",
      description: "Full plugin manifest with a description.",
      permissions: [],
      allowedHosts: [],
      contributes: { fences: [{ name: "x", render: "html" }] },
      render: "html",
      engines: { markspread: ">=1.3.0" },
    });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.warnings).toEqual([]);
  });
});

describe("installScaffold", () => {
  it("throws on invalid draft manifest", async () => {
    const host = new PluginHost({
      workerFactory: fakeReadyFactory(),
      handshakeTimeoutMs: 100,
    });
    const files = scaffoldPlugin({ name: "ok", kind: "codeblock", key: "ok" }).files;
    files["markspread-plugin.json"] = "{ not-json";
    await expect(installScaffold(host, "ok", files)).rejects.toThrow(/invalid manifest/);
    host.disposeAll();
  });

  it("writes via Tauri and installs into host on first call", async () => {
    invoke.mockResolvedValue("/tmp/p/demo");
    const host = new PluginHost({
      workerFactory: fakeReadyFactory(),
      handshakeTimeoutMs: 100,
    });
    const { files } = scaffoldPlugin({
      name: "demo",
      kind: "codeblock",
      key: "mermaid",
      hint: "demo",
    });
    const result = await installScaffold(host, "demo", files);
    expect(invoke).toHaveBeenCalledWith("plugin_scaffold_install", {
      name: "demo",
      files,
    });
    expect(result.pluginDir).toBe("/tmp/p/demo");
    expect(host.list().find((h) => h.manifest.name === "demo")?.state).toBe("ready");
    host.disposeAll();
  });

  it("reloads if plugin is already installed", async () => {
    invoke.mockResolvedValue("/tmp/p/demo");
    const host = new PluginHost({
      workerFactory: fakeReadyFactory(),
      handshakeTimeoutMs: 100,
    });
    const seed: PluginManifest = {
      schemaVersion: 1,
      name: "demo",
      version: "0.0.1",
      entry: "./index.js",
      permissions: [],
      allowedHosts: [],
      contributes: { codeblocks: { mermaid: { render: "html" } } },
      render: "html",
      engines: { markspread: ">=1.3.0" },
    };
    await host.install({ manifest: seed, pluginDir: "/tmp/p/demo", scope: "user" });
    const spy = vi.spyOn(host, "reload");
    const { files } = scaffoldPlugin({
      name: "demo",
      kind: "codeblock",
      key: "mermaid",
      hint: "v2",
      version: "0.2.0",
    });
    await installScaffold(host, "demo", files, { scope: "workspace" });
    expect(spy).toHaveBeenCalledWith("demo", expect.objectContaining({ version: "0.2.0" }));
    host.disposeAll();
  });
});
