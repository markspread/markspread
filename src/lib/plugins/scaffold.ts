// S-PL-SEC-001 (MAR-1019): public API for LLM-assisted plugin scaffolding.
//
// 본 모듈은 두 가지를 묶는다:
//   1. `scaffoldPlugin(spec)` — 메모리 상의 file 묶음을 빌드.
//   2. `installScaffold(host, dir, files)` — Tauri 명령으로 디스크에
//      떨어뜨리고 host 에 reload 를 트리거.
//
// `validateManifest` 는 chat agent 가 자기수정 루프에 쓸 수 있도록
// 구조화된 진단을 돌려준다 (scaffold/validator.ts 가 본체).
//
// Tauri 명령 `plugin_scaffold_install` 의 실제 fs 처리는 Rust 측 (
// `src-tauri/src/plugin_runtime.rs`) 에 있다. 본 모듈은 IPC seam 만 보유.

import { invoke } from "@tauri-apps/api/core";
import type { PluginHost } from "./runtime/host";
import { type ManifestParseResult, parseManifestText } from "./runtime/loader";
import type { PluginManifest } from "./runtime/types";
import {
  type ScaffoldFiles,
  type ScaffoldSpec,
  buildIndexJs,
  buildManifest,
  buildReadme,
} from "./scaffold/templates";
import { type ValidationResult, validateManifest } from "./scaffold/validator";

export type { ScaffoldFiles, ScaffoldSpec } from "./scaffold/templates";
export type { ValidationIssue, ValidationResult } from "./scaffold/validator";
export { validateManifest } from "./scaffold/validator";

/**
 * 사양으로부터 plugin file 묶음을 빌드. 디스크 접근 없음 — chat panel
 * 이 draft 를 사용자에게 그대로 보여줄 수 있도록 구성.
 */
export function scaffoldPlugin(spec: ScaffoldSpec): { files: ScaffoldFiles } {
  return {
    files: {
      "markspread-plugin.json": buildManifest(spec),
      "index.js": buildIndexJs(spec),
      "README.md": buildReadme(spec),
    },
  };
}

export interface InstallScaffoldResult {
  pluginDir: string;
  manifest: PluginManifest;
}

/**
 * draft 를 디스크에 떨어뜨리고 host 에 reload 를 시도한다.
 *
 * 흐름:
 *   1. manifest 가 valid 한지 (loader.parseManifestText) 확인 — invalid 면
 *      throw (chat panel 이 잡아 error 로 표시).
 *   2. Tauri `plugin_scaffold_install` 명령 호출 — Rust 가 fs 작업 + path
 *      검증을 수행하고 최종 plugin 디렉터리 경로를 돌려준다.
 *   3. host 가 해당 이름의 plugin 을 이미 알고 있으면 `reload`, 아니면
 *      `install` — host 는 이 분기를 알아서 처리하지 않으므로 caller 가
 *      list() 를 보고 결정한다.
 */
export async function installScaffold(
  host: PluginHost,
  name: string,
  files: ScaffoldFiles,
  opts: { scope?: "user" | "workspace" } = {},
): Promise<InstallScaffoldResult> {
  const parsed: ManifestParseResult = parseManifestText(files["markspread-plugin.json"]);
  if (!parsed.ok) {
    throw new Error(
      `invalid manifest: ${parsed.errors.map((e) => `${e.path}: ${e.message}`).join("; ")}`,
    );
  }
  const pluginDir = await invoke<string>("plugin_scaffold_install", {
    name,
    files,
  });
  const existing = host.list().find((h) => h.manifest.name === parsed.value.name);
  if (existing) {
    await host.reload(parsed.value.name, parsed.value);
  } else {
    await host.install({
      manifest: parsed.value,
      pluginDir,
      scope: opts.scope ?? "user",
    });
  }
  return { pluginDir, manifest: parsed.value };
}

/**
 * `scaffoldPlugin` + `validateManifest` 의 편의 조합. chat agent 가 한 번
 * 의 호출로 "draft + validation" 을 동시에 받을 수 있다.
 */
export function scaffoldAndValidate(spec: ScaffoldSpec): {
  files: ScaffoldFiles;
  validation: ValidationResult;
} {
  const { files } = scaffoldPlugin(spec);
  const validation = validateManifest(files["markspread-plugin.json"]);
  return { files, validation };
}
