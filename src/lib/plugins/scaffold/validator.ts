// S-PL-SEC-001 (MAR-1019): structured manifest validator for the chat agent.
//
// loader.ts 의 parseManifest 와 동일한 zod 스키마를 사용하되, 결과 형식을
// **에이전트가 자기교정하기 쉬운** 형태로 변환한다. 구체적으로:
//
//   - ok / errors / warnings 분리 (errors 는 deal-breaker, warnings 는 hint).
//   - path/message 외에 `hint` 필드 — "what the agent should do next".
//   - 가장 흔한 실수 (network 권한 없이 allowedHosts 채움 등) 에 대한
//     사전 휴리스틱.
//
// 본 validator 는 ChatShell 의 PluginAuthorPanel 가 "Validate" 버튼을 누를
// 때 호출되고, 에러 묶음을 그대로 LLM 컨텍스트로 흘려 보내 자가수정 한
// 라운드를 유도하는 데 쓰인다.

import { parseManifest, parseManifestText } from "../runtime/loader";
import type { PluginManifest } from "../runtime/types";

export interface ValidationIssue {
  path: string;
  message: string;
  /** 에이전트/사용자에게 "다음에 무엇을 고치면 되는가" 를 한 줄로. */
  hint?: string;
}

export type ValidationResult =
  | { ok: true; manifest: PluginManifest; warnings: ValidationIssue[] }
  | { ok: false; errors: ValidationIssue[]; warnings: ValidationIssue[] };

/**
 * Manifest 객체 또는 JSON 문자열을 받아 구조화된 결과를 돌려준다. 입력이
 * string 이면 JSON parse 까지 처리하고, object 면 즉시 schema 검증.
 */
export function validateManifest(input: unknown): ValidationResult {
  const baseResult = typeof input === "string" ? parseManifestText(input) : parseManifest(input);
  if (!baseResult.ok) {
    return {
      ok: false,
      errors: baseResult.errors.map(decorateError),
      warnings: [],
    };
  }
  const warnings = collectWarnings(baseResult.value);
  return { ok: true, manifest: baseResult.value, warnings };
}

function decorateError(e: { path: string; message: string }): ValidationIssue {
  // 자주 보이는 에러에 한해 hint 를 덧붙인다. 그 외는 path/message 그대로.
  if (e.path === "name") {
    return {
      ...e,
      hint: 'Use lowercase letters, digits and dashes only (≤32 chars). Example: "my-plugin".',
    };
  }
  if (e.path === "version") {
    return { ...e, hint: 'Use SemVer like "0.1.0" or "1.2.3".' };
  }
  if (e.path === "allowedHosts") {
    return {
      ...e,
      hint: 'If you request the "network" permission, list at least one host (e.g. "api.github.com").',
    };
  }
  if (e.path === "entry") {
    return {
      ...e,
      hint: 'Use a relative path inside the plugin folder, e.g. "./index.js".',
    };
  }
  if (e.path === "$") {
    return { ...e, hint: "Make sure the file is valid JSON (no trailing commas, no comments)." };
  }
  return e;
}

function collectWarnings(m: PluginManifest): ValidationIssue[] {
  const warnings: ValidationIssue[] = [];
  // contributes 는 schema 의 default({}) 로 항상 존재; 빈 객체면 hook 이
  // 하나도 등록되지 않는 no-op 플러그인.
  const c = m.contributes;
  const codeblockCount = c.codeblocks ? Object.keys(c.codeblocks).length : 0;
  const fenceCount = c.fences ? c.fences.length : 0;
  const headerCount = c.headers ? Object.keys(c.headers).length : 0;
  const inlineCount = c.inlineRules ? c.inlineRules.length : 0;
  const hasAnything = codeblockCount + fenceCount + headerCount + inlineCount > 0;
  if (!hasAnything) {
    warnings.push({
      path: "contributes",
      message: "plugin declares no contributions — it will register nothing",
      hint: "Add at least one entry under contributes.codeblocks, .fences, .headers or .inlineRules.",
    });
  }
  // network 권한이 없는데 allowedHosts 가 채워져 있으면 의미 없음.
  if (!m.permissions.includes("network") && m.allowedHosts.length > 0) {
    warnings.push({
      path: "allowedHosts",
      message: 'allowedHosts is ignored without the "network" permission',
      hint: 'Either add "network" to permissions or empty allowedHosts.',
    });
  }
  // 디폴트 description 이 비어 있으면 마켓플레이스 노출에 불리.
  if (!m.description) {
    warnings.push({
      path: "description",
      message: "no description set — users will see only the plugin name",
      hint: "Add a one-sentence description to manifest.description.",
    });
  }
  return warnings;
}
