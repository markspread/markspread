// MAR-1021: regression tests for the VSCode markdown contributes translator.

import { describe, expect, it } from "vitest";
import { PluginHost, type WorkerFactory } from "./runtime/host";
import { parseManifest } from "./runtime/loader";
import { type Message, type WorkerLike, createFakeWorkerPair } from "./runtime/sandbox-rpc";
import {
  type VSCodePackageJson,
  translateVSCodePackage,
  translateVSCodePackageText,
} from "./vscode-compat";

const NUL = String.fromCharCode(0);

const minimal: VSCodePackageJson = {
  name: "vscode-markdown-mermaid",
  version: "1.20.0",
  main: "./out/extension.js",
  engines: { vscode: "^1.80.0", markspread: ">=1.0.0" },
  contributes: {
    markdown: {
      previewStyles: ["./styles/mermaid.css"],
      previewScripts: ["./out/preview.js"],
      markdownItPlugins: true,
    },
  },
};

describe("translateVSCodePackage", () => {
  it("translates a typical mermaid-style extension", () => {
    const r = translateVSCodePackage(minimal);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.manifest.name).toBe("vscode-markdown-mermaid");
    expect(r.manifest.entry).toBe("out/extension.js");
    expect(r.manifest.engines.markspread).toBe(">=1.0.0");
    expect(r.manifest.vscodeAssets.previewStyles).toEqual(["styles/mermaid.css"]);
    expect(r.manifest.vscodeAssets.previewScripts).toEqual(["out/preview.js"]);
    expect(r.manifest.vscodeAssets.markdownItPlugin).toBe(true);
    expect(r.manifest.contributes.fences?.[0]?.name).toBe("vscode-markdown-mermaid");
  });

  it("produces a manifest that the canonical Markspread validator accepts", () => {
    const r = translateVSCodePackage(minimal);
    if (!r.ok) throw new Error("translator rejected fixture");
    const { vscodeAssets: _vscodeAssets, ...canonical } = r.manifest;
    const re = parseManifest(canonical);
    expect(re.ok).toBe(true);
  });

  it("defaults engines.markspread to >=0.0.0 when omitted", () => {
    const r = translateVSCodePackage({ ...minimal, engines: { vscode: "^1.80.0" } });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.manifest.engines.markspread).toBe(">=0.0.0");
  });

  it("normalises scoped or camelCase package names to a Markspread slug", () => {
    const r = translateVSCodePackage({ ...minimal, name: "@acme/Pretty.Mermaid_v2" });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.manifest.name).toBe("pretty-mermaid-v2");
  });

  it("warns when no PoC-supported contribution is present", () => {
    const r = translateVSCodePackage({ ...minimal, contributes: { markdown: {} } });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.warnings.find((w) => w.path === "contributes.markdown")).toBeTruthy();
      expect(r.manifest.vscodeAssets.previewStyles).toEqual([]);
      expect(r.manifest.contributes.fences).toBeUndefined();
    }
  });

  it("drops asset paths that escape the plugin directory", () => {
    const r = translateVSCodePackage({
      ...minimal,
      contributes: {
        markdown: {
          previewStyles: ["./ok.css", "../escape.css", "/abs.css"],
          previewScripts: 42 as unknown as string[],
        },
      },
    });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.manifest.vscodeAssets.previewStyles).toEqual(["ok.css"]);
    expect(r.warnings.some((w) => w.path.startsWith("contributes.markdown.previewStyles[1]"))).toBe(
      true,
    );
    expect(r.warnings.some((w) => w.path.startsWith("contributes.markdown.previewStyles[2]"))).toBe(
      true,
    );
    expect(r.warnings.some((w) => w.path === "contributes.markdown.previewScripts")).toBe(true);
  });

  it("rejects non-object input", () => {
    const r = translateVSCodePackage("not a package");
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors[0]?.path).toBe("$");
  });

  it("rejects packages missing name or version", () => {
    const r = translateVSCodePackage({ main: "./x.js" });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      const paths = r.errors.map((e) => e.path);
      expect(paths).toContain("name");
      expect(paths).toContain("version");
    }
  });

  it("rejects packages whose name cannot be normalised", () => {
    const r = translateVSCodePackage({ ...minimal, name: "!!!" });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors[0]?.path).toBe("name");
  });

  it("rejects packages without a main entry", () => {
    const r = translateVSCodePackage({ ...minimal, main: undefined as unknown as string });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors[0]?.path).toBe("main");
  });

  it("rejects absolute or traversing main paths", () => {
    const r = translateVSCodePackage({ ...minimal, main: "/etc/passwd" });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors[0]?.path).toBe("main");
  });
});

describe("translateVSCodePackage branch coverage", () => {
  it("handles a package with no contributes key", () => {
    const r = translateVSCodePackage({
      name: "barebones",
      version: "0.1.0",
      main: "index.js",
    });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.manifest.vscodeAssets.previewStyles).toEqual([]);
      expect(r.warnings[0]?.path).toBe("contributes.markdown");
    }
  });

  it("treats contributes:null as no contribution", () => {
    const r = translateVSCodePackage({
      name: "nullc",
      version: "0.1.0",
      main: "index.js",
      contributes: null as unknown as { markdown: VSCodePackageJson["contributes"] },
    });
    expect(r.ok).toBe(true);
  });

  it("defaults engine range when engines key is absent", () => {
    const r = translateVSCodePackage({
      name: "no-engines",
      version: "0.1.0",
      main: "index.js",
      contributes: { markdown: { markdownItPlugins: true } },
    });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.manifest.engines.markspread).toBe(">=0.0.0");
  });

  it("rejects non-string asset entries with a typeof label", () => {
    const r = translateVSCodePackage({
      ...minimal,
      contributes: {
        markdown: { previewStyles: [{ not: "a string" } as unknown as string] },
      },
    });
    expect(r.ok).toBe(true);
    if (r.ok) {
      const w = r.warnings.find((x) => x.path === "contributes.markdown.previewStyles[0]");
      expect(w?.message).toMatch(/object/);
    }
  });

  it("drops windows-drive-style asset paths", () => {
    const r = translateVSCodePackage({
      ...minimal,
      contributes: { markdown: { previewStyles: ["C:/abs.css"] } },
    });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.manifest.vscodeAssets.previewStyles).toEqual([]);
    }
  });

  it("rejects asset paths containing a NUL byte", () => {
    const r = translateVSCodePackage({
      ...minimal,
      contributes: { markdown: { previewStyles: [`bad${NUL}.css`] } },
    });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.manifest.vscodeAssets.previewStyles).toEqual([]);
    }
  });

  it("rejects asset paths that traverse via .. segment", () => {
    const r = translateVSCodePackage({
      ...minimal,
      contributes: { markdown: { previewStyles: ["a/../b.css"] } },
    });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.manifest.vscodeAssets.previewStyles).toEqual([]);
    }
  });

  it("rejects main with Windows drive prefix", () => {
    const r = translateVSCodePackage({ ...minimal, main: "C:\\bad\\ext.js" });
    expect(r.ok).toBe(false);
  });

  it("rejects main containing a NUL byte", () => {
    const r = translateVSCodePackage({ ...minimal, main: `ext${NUL}.js` });
    expect(r.ok).toBe(false);
  });

  it("rejects an empty-string asset entry", () => {
    const r = translateVSCodePackage({
      ...minimal,
      contributes: { markdown: { previewStyles: [""] } },
    });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.manifest.vscodeAssets.previewStyles).toEqual([]);
    }
  });

  it("carries string displayName and description through to the manifest", () => {
    const r = translateVSCodePackage({
      ...minimal,
      displayName: "Mermaid Preview",
      description: "Render mermaid diagrams in preview.",
    });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.manifest.displayName).toBe("Mermaid Preview");
      expect(r.manifest.description).toBe("Render mermaid diagrams in preview.");
    }
  });

  it("ignores non-string displayName and description", () => {
    const r = translateVSCodePackage({
      ...minimal,
      displayName: 42 as unknown as string,
      description: { not: "a string" } as unknown as string,
    });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.manifest.displayName).toBeUndefined();
      expect(r.manifest.description).toBeUndefined();
    }
  });

  it("surfaces parseManifest errors when a downstream field is invalid", () => {
    const r = translateVSCodePackage({ ...minimal, version: "not-a-semver" });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors.some((e) => e.path === "version")).toBe(true);
  });
});

describe("PluginHost interprets translated VSCode manifest via the same hook", () => {
  function fakeWorkerFactory(
    behaviour: (host: WorkerLike, plugin: WorkerLike) => void,
  ): WorkerFactory {
    return () => {
      const { hostSide, pluginSide } = createFakeWorkerPair();
      behaviour(hostSide, pluginSide);
      return hostSide;
    };
  }

  it("registers the synthesised fence and dispatches via renderFence", async () => {
    const r = translateVSCodePackage(minimal);
    if (!r.ok) throw new Error("translator rejected fixture");
    const fenceName = r.manifest.contributes.fences?.[0]?.name;
    expect(fenceName).toBe("vscode-markdown-mermaid");

    const host = new PluginHost({
      handshakeTimeoutMs: 100,
      workerFactory: fakeWorkerFactory((_h, plugin) => {
        plugin.addEventListener("message", (ev) => {
          const m = ev.data as Message;
          if (m.type === "host:init") {
            plugin.postMessage({
              type: "plugin:ready",
              registered: [{ kind: "fence", key: fenceName }],
            });
          } else if (m.type === "hook:invoke") {
            plugin.postMessage({
              type: "hook:result",
              requestId: m.requestId,
              result: { kind: "html", html: `<mermaid>${m.payload.source}</mermaid>` },
            });
          }
        });
      }),
    });

    const { vscodeAssets: _drop, ...canonical } = r.manifest;
    const handle = await host.install({
      manifest: canonical,
      pluginDir: "/tmp/vscode-mermaid",
      scope: "user",
    });
    expect(handle.state).toBe("ready");
    expect(handle.registered).toContain(`fence.${fenceName}`);

    const out = await host.renderFence(fenceName as string, "graph TD; A-->B", {
      documentPath: "/doc.md",
    });
    expect(out?.kind).toBe("html");
    if (out?.kind === "html") expect(out.html).toBe("<mermaid>graph TD; A-->B</mermaid>");
    host.disposeAll();
  });
});

describe("translateVSCodePackageText", () => {
  it("validates raw JSON", () => {
    const r = translateVSCodePackageText(JSON.stringify(minimal));
    expect(r.ok).toBe(true);
  });

  it("reports JSON parse failure", () => {
    const r = translateVSCodePackageText("not json");
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors[0]?.message).toMatch(/JSON parse error/);
  });
});
