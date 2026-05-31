// MAR-1031 (ADR-0013): Markspread PluginManifest → VSCode/Cursor `package.json`
// `contributes.markdown` spec export.
//
// 본 도구가 만든 *런타임 파서 플러그인* 을 VSCode/Cursor 마켓플레이스에 배포할 수 있는
// `package.json` 으로 변환한다. ADR-0013 = export only — import 방향은 (vscode-compat.ts)
// dev-only spec 이해 헬퍼로 격리.
//
// 변환 규칙 (PoC scope):
//   - Markspread name (이미 슬러그) → VSCode `name` 그대로
//   - Markspread version → `version`
//   - Markspread entry → `main` (VSCode 의 ext entry script)
//   - Markspread displayName/description → 그대로
//   - Markspread `vscodeAssets` (있으면) → `contributes.markdown.previewStyles/Scripts/markdownItPlugins`
//     없으면 *기본* 추론: `contributes.fences` 가 1개 이상 = `markdownItPlugins: true`
//   - Markspread engines.markspread → 그대로 + 신규 `engines.vscode` (호출자 또는 default)
//
// 의도적 비목표:
//   - VSCode contribution points (commands, languages, grammars) 의 full coverage X
//   - VSCode 패키징 (vsce package) 자동 실행 X — 사용자가 별도 수행
//   - signature/marketplace metadata X

import type { PluginManifest } from "./runtime/types";
import { isRelativeAsset, normaliseName, stripLeadingDot } from "./vscode-spec-validator";

export interface VSCodeExportOptions {
  /** VSCode engines 호환 범위 (default `^1.80.0`). */
  vscodeEngine?: string;
  /** publisher 필드 (없으면 출력에서 누락). */
  publisher?: string;
}

export interface VSCodeExportWarning {
  path: string;
  message: string;
}

export interface VSCodeExportPackage {
  name: string;
  displayName?: string;
  description?: string;
  version: string;
  publisher?: string;
  main: string;
  engines: { vscode: string; markspread?: string };
  contributes: {
    markdown?: {
      previewStyles?: string[];
      previewScripts?: string[];
      markdownItPlugins?: boolean;
    };
  };
}

export type VSCodeExportResult =
  | { ok: true; pkg: VSCodeExportPackage; warnings: VSCodeExportWarning[] }
  | { ok: false; errors: VSCodeExportWarning[] };

/**
 * Markspread manifest → VSCode package.json 변환.
 *
 * 호출자는 결과 `pkg` 를 JSON.stringify 해서 그대로 `package.json` 으로 사용.
 * `vscodeAssets` 가 manifest 에 *없는* 일반 케이스에서는, `contributes.fences`
 * 가 1개라도 있으면 `markdownItPlugins: true` 로 추론 (markdown-it factory entry
 * 가 export 되어 있다는 의미).
 */
export function exportToVSCode(
  manifest: PluginManifest & {
    vscodeAssets?: { previewStyles: string[]; previewScripts: string[]; markdownItPlugin: boolean };
  },
  opts: VSCodeExportOptions = {},
): VSCodeExportResult {
  const errors: VSCodeExportWarning[] = [];
  const warnings: VSCodeExportWarning[] = [];

  if (!manifest.name) errors.push({ path: "name", message: "missing" });
  if (!manifest.version) errors.push({ path: "version", message: "missing" });
  if (!manifest.entry) errors.push({ path: "entry", message: "missing" });
  if (errors.length > 0) return { ok: false, errors };

  // entry 는 이미 Markspread 내에서 검증된 상대 경로지만, export 시점에 한 번 더 확인.
  if (!isRelativeAsset(manifest.entry)) {
    return {
      ok: false,
      errors: [{ path: "entry", message: `entry must be relative: ${manifest.entry}` }],
    };
  }

  // 이름은 이미 슬러그라 그대로 사용. 단 *VSCode marketplace* 의 추가 제약은 없으니
  // normaliseName 으로 한 번 더 통과시켜 안전망 유지 (idempotent).
  const exportedName = normaliseName(manifest.name);
  if (exportedName !== manifest.name) {
    warnings.push({
      path: "name",
      message: `normalised "${manifest.name}" → "${exportedName}" for VSCode marketplace`,
    });
  }

  const v = manifest.vscodeAssets;
  const styles = v?.previewStyles?.filter(isRelativeAsset).map(stripLeadingDot) ?? [];
  const scripts = v?.previewScripts?.filter(isRelativeAsset).map(stripLeadingDot) ?? [];

  // markdownItPlugins 추론:
  //   - vscodeAssets.markdownItPlugin === true → 그대로
  //   - 아니면 contributes.fences 가 1개라도 있으면 true (markdown-it factory 가정)
  //   - 둘 다 아니면 undefined (필드 누락)
  let markdownItPlugins: boolean | undefined;
  if (v?.markdownItPlugin === true) markdownItPlugins = true;
  else if ((manifest.contributes.fences?.length ?? 0) > 0) {
    markdownItPlugins = true;
    warnings.push({
      path: "contributes.markdown.markdownItPlugins",
      message: "inferred from contributes.fences presence",
    });
  }

  const contributesMarkdown: VSCodeExportPackage["contributes"]["markdown"] = {};
  if (styles.length > 0) contributesMarkdown.previewStyles = styles;
  if (scripts.length > 0) contributesMarkdown.previewScripts = scripts;
  if (markdownItPlugins === true) contributesMarkdown.markdownItPlugins = true;

  const pkg: VSCodeExportPackage = {
    name: exportedName,
    version: manifest.version,
    main: stripLeadingDot(manifest.entry),
    engines: {
      vscode: opts.vscodeEngine ?? "^1.80.0",
      markspread: manifest.engines.markspread,
    },
    contributes:
      Object.keys(contributesMarkdown).length > 0 ? { markdown: contributesMarkdown } : {},
  };
  if (manifest.displayName) pkg.displayName = manifest.displayName;
  if (manifest.description) pkg.description = manifest.description;
  if (opts.publisher) pkg.publisher = opts.publisher;

  return { ok: true, pkg, warnings };
}

/** JSON 직렬화 헬퍼 — 호출자가 곧바로 package.json 으로 사용 가능. */
export function exportToVSCodeText(
  manifest: Parameters<typeof exportToVSCode>[0],
  opts?: VSCodeExportOptions,
):
  | { ok: true; json: string; warnings: VSCodeExportWarning[] }
  | { ok: false; errors: VSCodeExportWarning[] } {
  const r = exportToVSCode(manifest, opts);
  if (!r.ok) return r;
  return { ok: true, json: JSON.stringify(r.pkg, null, 2), warnings: r.warnings };
}
