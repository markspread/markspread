// MAR-1031 (ADR-0013): vscode-export 검증 + round-trip (import → export → import) 테스트.

import { describe, expect, it } from "vitest";
import type { PluginManifest } from "./runtime/types";
import { type VSCodePackageJson, translateVSCodePackage } from "./vscode-compat";
import { exportToVSCode, exportToVSCodeText } from "./vscode-export";

function baseManifest(overrides: Partial<PluginManifest> = {}): PluginManifest {
  return {
    schemaVersion: 1,
    name: "vscode-markdown-mermaid",
    version: "1.20.0",
    entry: "out/extension.js",
    displayName: "Mermaid Preview",
    description: "Render mermaid diagrams in preview.",
    permissions: [],
    allowedHosts: [],
    contributes: { fences: [{ name: "vscode-markdown-mermaid", render: "html" as const }] },
    render: "html",
    engines: { markspread: ">=1.0.0" },
    ...overrides,
  };
}

describe("exportToVSCode", () => {
  it("exports a typical mermaid-style parser manifest", () => {
    const r = exportToVSCode(baseManifest());
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.pkg.name).toBe("vscode-markdown-mermaid");
    expect(r.pkg.version).toBe("1.20.0");
    expect(r.pkg.main).toBe("out/extension.js");
    expect(r.pkg.displayName).toBe("Mermaid Preview");
    expect(r.pkg.description).toBe("Render mermaid diagrams in preview.");
    expect(r.pkg.engines.vscode).toBe("^1.80.0");
    expect(r.pkg.engines.markspread).toBe(">=1.0.0");
    // fences 존재 → markdownItPlugins 추론
    expect(r.pkg.contributes.markdown?.markdownItPlugins).toBe(true);
    expect(r.warnings.some((w) => w.path.endsWith("markdownItPlugins"))).toBe(true);
  });

  it("respects custom vscodeEngine and publisher options", () => {
    const r = exportToVSCode(baseManifest(), { vscodeEngine: "^1.90.0", publisher: "acme" });
    if (!r.ok) throw new Error("export failed");
    expect(r.pkg.engines.vscode).toBe("^1.90.0");
    expect(r.pkg.publisher).toBe("acme");
  });

  it("forwards vscodeAssets when provided", () => {
    const m = baseManifest({ contributes: {} }) as PluginManifest & {
      vscodeAssets: {
        previewStyles: string[];
        previewScripts: string[];
        markdownItPlugin: boolean;
      };
    };
    m.vscodeAssets = {
      previewStyles: ["styles/mermaid.css"],
      previewScripts: ["out/preview.js"],
      markdownItPlugin: true,
    };
    const r = exportToVSCode(m);
    if (!r.ok) throw new Error("export failed");
    expect(r.pkg.contributes.markdown?.previewStyles).toEqual(["styles/mermaid.css"]);
    expect(r.pkg.contributes.markdown?.previewScripts).toEqual(["out/preview.js"]);
    expect(r.pkg.contributes.markdown?.markdownItPlugins).toBe(true);
  });

  it("normalises non-slug name with a warning", () => {
    // 이론상 manifest 는 이미 슬러그지만 안전망 검증.
    const r = exportToVSCode(baseManifest({ name: "MIXED_Name" as unknown as string }));
    if (!r.ok) throw new Error("export failed");
    expect(r.pkg.name).toBe("mixed-name");
    expect(r.warnings.some((w) => w.path === "name")).toBe(true);
  });

  it("omits empty contributes.markdown when no preview fields present", () => {
    const m = baseManifest({ contributes: {} });
    const r = exportToVSCode(m);
    if (!r.ok) throw new Error("export failed");
    expect(r.pkg.contributes).toEqual({});
  });

  it("rejects missing required fields", () => {
    const r = exportToVSCode(baseManifest({ name: "" as unknown as string }));
    expect(r.ok).toBe(false);
  });

  it("rejects missing version", () => {
    const r = exportToVSCode(baseManifest({ version: "" as unknown as string }));
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.errors.some((e) => e.path === "version")).toBe(true);
  });

  it("rejects missing entry", () => {
    const r = exportToVSCode(baseManifest({ entry: "" as unknown as string }));
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.errors.some((e) => e.path === "entry")).toBe(true);
  });

  it("rejects non-relative entry", () => {
    const m = baseManifest();
    (m as { entry: string }).entry = "/etc/passwd";
    const r = exportToVSCode(m);
    expect(r.ok).toBe(false);
  });

  it("strips ./ prefix from entry", () => {
    const r = exportToVSCode(baseManifest({ entry: "./out/extension.js" }));
    if (!r.ok) throw new Error("export failed");
    expect(r.pkg.main).toBe("out/extension.js");
  });
});

describe("exportToVSCodeText", () => {
  it("emits valid JSON that parses back to the same package shape", () => {
    const r = exportToVSCodeText(baseManifest());
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const parsed = JSON.parse(r.json) as { name: string; version: string };
    expect(parsed.name).toBe("vscode-markdown-mermaid");
    expect(parsed.version).toBe("1.20.0");
  });

  it("forwards errors when underlying export fails", () => {
    const r = exportToVSCodeText(baseManifest({ name: "" as unknown as string }));
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.errors.some((e) => e.path === "name")).toBe(true);
  });
});

describe("round-trip — VSCode → Markspread → VSCode", () => {
  const vscodePkg: VSCodePackageJson = {
    name: "vscode-markdown-mermaid",
    version: "1.20.0",
    main: "./out/extension.js",
    displayName: "Mermaid Preview",
    description: "Render mermaid diagrams in preview.",
    engines: { vscode: "^1.80.0", markspread: ">=1.0.0" },
    contributes: {
      markdown: {
        previewStyles: ["./styles/mermaid.css"],
        previewScripts: ["./out/preview.js"],
        markdownItPlugins: true,
      },
    },
  };

  it("preserves core identity through the cycle", () => {
    const importR = translateVSCodePackage(vscodePkg);
    expect(importR.ok).toBe(true);
    if (!importR.ok) return;

    const exportR = exportToVSCode(importR.manifest);
    expect(exportR.ok).toBe(true);
    if (!exportR.ok) return;

    expect(exportR.pkg.name).toBe(vscodePkg.name);
    expect(exportR.pkg.version).toBe(vscodePkg.version);
    expect(exportR.pkg.main).toBe("out/extension.js"); // ./ stripped
    expect(exportR.pkg.displayName).toBe(vscodePkg.displayName);
    expect(exportR.pkg.description).toBe(vscodePkg.description);
    expect(exportR.pkg.engines.markspread).toBe(">=1.0.0");
    expect(exportR.pkg.contributes.markdown?.previewStyles).toEqual(["styles/mermaid.css"]);
    expect(exportR.pkg.contributes.markdown?.previewScripts).toEqual(["out/preview.js"]);
    expect(exportR.pkg.contributes.markdown?.markdownItPlugins).toBe(true);
  });

  it("strips unsafe asset paths consistently across import and export", () => {
    const dirty: VSCodePackageJson = {
      ...vscodePkg,
      contributes: {
        markdown: {
          previewStyles: ["./ok.css", "../escape.css", "/abs.css"],
          markdownItPlugins: true,
        },
      },
    };
    const importR = translateVSCodePackage(dirty);
    if (!importR.ok) throw new Error("import unexpectedly failed");
    const exportR = exportToVSCode(importR.manifest);
    if (!exportR.ok) throw new Error("export unexpectedly failed");
    expect(exportR.pkg.contributes.markdown?.previewStyles).toEqual(["ok.css"]);
  });
});
