// MAR-1021: VSCode markdown contributes → Markspread manifest translator (PoC).
//
// Scope (ADR-0012 U5): the three PoC fields under
// `package.json#contributes.markdown`:
//   - previewStyles: CSS files injected into the preview.
//   - previewScripts: JS files run inside the preview frame.
//   - markdownItPlugins: when `true`, the extension's `main` exports a
//     factory `(md, ...) => md` that registers markdown-it rules.
//
// The translator emits a Markspread `PluginManifest` (see runtime/types.ts)
// plus a side-channel `assets` record carrying the VSCode-specific
// preview style/script paths so the renderer's preview pipeline can
// inject them. Markspread's manifest schema allows unknown top-level
// keys (forward-compat passthrough), so the assets ride on the manifest
// as `vscodeAssets` for the host wiring to pick up.
//
// What this PoC does NOT do:
//   - Translate non-markdown VSCode contribution points.
//   - Sandbox or signature-check the VSCode bundle.
//   - Resolve activation events — Markspread plugins activate on document
//     open today; events stay best-effort metadata.

import { type ManifestParseError, parseManifest } from "./runtime/loader";
import type { PluginManifest } from "./runtime/types";

export interface VSCodeMarkdownContributes {
  previewStyles?: string[];
  previewScripts?: string[];
  markdownItPlugins?: boolean;
}

export interface VSCodePackageJson {
  name: string;
  version: string;
  displayName?: string;
  description?: string;
  main?: string;
  engines?: { vscode?: string; markspread?: string };
  contributes?: { markdown?: VSCodeMarkdownContributes };
}

export interface VSCodeAssets {
  previewStyles: string[];
  previewScripts: string[];
  markdownItPlugin: boolean;
}

export interface VSCodeTranslateWarning {
  path: string;
  message: string;
}

export type VSCodeTranslateResult =
  | {
      ok: true;
      manifest: PluginManifest & { vscodeAssets: VSCodeAssets };
      warnings: VSCodeTranslateWarning[];
    }
  | { ok: false; errors: ManifestParseError[] };

const NAME_RE = /^[a-z0-9][a-z0-9-]{0,31}$/;

function normaliseName(raw: string): string {
  const slug = raw
    .toLowerCase()
    .replace(/^@[^/]+\//, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 32);
  return slug;
}

function isRelativeAsset(p: unknown): p is string {
  if (typeof p !== "string" || p.length === 0) return false;
  if (p.startsWith("/")) return false;
  if (/^[a-zA-Z]:[\\/]/.test(p)) return false;
  if (p.includes("\0")) return false;
  const normalised = p.replace(/\\/g, "/");
  for (const seg of normalised.split("/")) {
    if (seg === "..") return false;
  }
  return true;
}

/**
 * Translate a VSCode-style `package.json` object into a Markspread
 * `PluginManifest`. Returns `{ ok: false, errors }` when the input is
 * structurally invalid; `warnings` enumerate fields that were silently
 * downgraded or ignored (e.g. asset paths that escape the plugin dir).
 */
export function translateVSCodePackage(input: unknown): VSCodeTranslateResult {
  const errors: ManifestParseError[] = [];
  if (typeof input !== "object" || input === null) {
    return { ok: false, errors: [{ path: "$", message: "package.json must be an object" }] };
  }
  const pkg = input as Record<string, unknown>;
  const name = typeof pkg.name === "string" ? pkg.name : "";
  const version = typeof pkg.version === "string" ? pkg.version : "";
  if (!name) errors.push({ path: "name", message: "missing string" });
  if (!version) errors.push({ path: "version", message: "missing string" });
  if (errors.length > 0) return { ok: false, errors };

  const normalised = normaliseName(name);
  if (!NAME_RE.test(normalised)) {
    return {
      ok: false,
      errors: [{ path: "name", message: `cannot normalise "${name}" to Markspread plugin name` }],
    };
  }

  const main = typeof pkg.main === "string" ? pkg.main : "";
  if (!main) {
    return { ok: false, errors: [{ path: "main", message: "missing entry script" }] };
  }
  if (!isRelativeAsset(main)) {
    return {
      ok: false,
      errors: [{ path: "main", message: `entry must be relative path: ${main}` }],
    };
  }

  const contributes =
    typeof pkg.contributes === "object" && pkg.contributes !== null
      ? (pkg.contributes as { markdown?: VSCodeMarkdownContributes }).markdown
      : undefined;

  const warnings: VSCodeTranslateWarning[] = [];
  const styles = collectAssets(contributes?.previewStyles, "previewStyles", warnings);
  const scripts = collectAssets(contributes?.previewScripts, "previewScripts", warnings);
  const markdownItPlugin = contributes?.markdownItPlugins === true;

  if (styles.length === 0 && scripts.length === 0 && !markdownItPlugin) {
    warnings.push({
      path: "contributes.markdown",
      message: "no PoC-supported fields present (previewStyles/previewScripts/markdownItPlugins)",
    });
  }

  const engines = (pkg.engines as { markspread?: string } | undefined) ?? {};
  const engineRange =
    typeof engines.markspread === "string" && engines.markspread.length > 0
      ? engines.markspread
      : ">=0.0.0";

  const candidate = {
    schemaVersion: 1 as const,
    name: normalised,
    version,
    entry: main.replace(/^\.\//, ""),
    displayName: typeof pkg.displayName === "string" ? pkg.displayName : undefined,
    description: typeof pkg.description === "string" ? pkg.description : undefined,
    permissions: [],
    allowedHosts: [],
    contributes: markdownItPlugin
      ? { fences: [{ name: normalised, render: "html" as const }] }
      : {},
    render: "html" as const,
    engines: { markspread: engineRange },
    vscodeAssets: {
      previewStyles: styles,
      previewScripts: scripts,
      markdownItPlugin,
    },
  };

  const parsed = parseManifest(candidate);
  if (!parsed.ok) return { ok: false, errors: parsed.errors };

  return {
    ok: true,
    manifest: { ...parsed.value, vscodeAssets: candidate.vscodeAssets } as PluginManifest & {
      vscodeAssets: VSCodeAssets;
    },
    warnings,
  };
}

function collectAssets(raw: unknown, field: string, warnings: VSCodeTranslateWarning[]): string[] {
  if (raw === undefined) return [];
  if (!Array.isArray(raw)) {
    warnings.push({ path: `contributes.markdown.${field}`, message: "expected array, ignored" });
    return [];
  }
  const out: string[] = [];
  for (let i = 0; i < raw.length; i += 1) {
    const v = raw[i];
    if (isRelativeAsset(v)) {
      out.push(v.replace(/^\.\//, ""));
    } else {
      warnings.push({
        path: `contributes.markdown.${field}[${i}]`,
        message: `dropped non-relative path: ${typeof v === "string" ? v : typeof v}`,
      });
    }
  }
  return out;
}

/** Convenience wrapper for raw JSON text. */
export function translateVSCodePackageText(raw: string): VSCodeTranslateResult {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (e) {
    return {
      ok: false,
      errors: [{ path: "$", message: `JSON parse error: ${(e as Error).message}` }],
    };
  }
  return translateVSCodePackage(parsed);
}
