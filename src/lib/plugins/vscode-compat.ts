// MAR-1021 (legacy import direction) + MAR-1031 (refactor per ADR-0013):
//
// ⚠️ ADR-0013 decision: VSCode/Cursor 호환 = *export only*. *Import* 방향 (이 파일)
// 은 **dev-only spec 이해 헬퍼** 로 격리. v1 사용자 흐름 (Markspread 안에서 VSCode
// 플러그인 *설치*) ❌. 본 모듈은 spec 회귀·테스트·역방향 round-trip 검증 용도.
//
// Scope (PoC 한정): `package.json#contributes.markdown` 의 세 필드:
//   - previewStyles: CSS files injected into the preview.
//   - previewScripts: JS files run inside the preview frame.
//   - markdownItPlugins: when `true`, the extension's `main` exports a
//     factory `(md, ...) => md` that registers markdown-it rules.
//
// 공통 검증 로직 (name normalize, path safety) 은 `vscode-spec-validator.ts` 로
// 분리됨 — `vscode-export.ts` 와 양방향 공유.
//
// What this does NOT do:
//   - Translate non-markdown VSCode contribution points.
//   - Sandbox or signature-check the VSCode bundle.
//   - Activate plugins as part of v1 runtime flow (= scope 밖).

import { type ManifestParseError, parseManifest } from "./runtime/loader";
import type { PluginManifest } from "./runtime/types";
import {
  isRelativeAsset,
  isValidName,
  normaliseName,
  stripLeadingDot,
} from "./vscode-spec-validator";

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

// 공통 검증 로직은 vscode-spec-validator.ts 로 분리됨 (ADR-0013 refactor).
// normaliseName / isValidName / isRelativeAsset / stripLeadingDot 은 그 모듈에서 import.

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
  if (!isValidName(normalised)) {
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
    entry: stripLeadingDot(main),
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
      out.push(stripLeadingDot(v));
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
