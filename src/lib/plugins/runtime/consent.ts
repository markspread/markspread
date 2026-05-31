// ADR-0016 (T5.F): 신규 파서 활성 시 1회 동의 다이얼로그 로직.
//
// UI 컴포넌트 (e.g. `<ConsentDialog />`) 는 본 모듈의 함수만 호출.
// 로직-UI 분리로 headless 테스트 가능.
//
// 동의 로직:
//   1. plugin trust level 조회
//   2. local → 다이얼로그 skip + 즉시 활성
//   3. llm-generated / imported → 다이얼로그 노출 필요
//      - 호출자가 UI 다이얼로그 띄움 (AI 한 줄 요약 + 전체 코드 + Accept/Reject)
//      - Accept → recordConsent
//      - Reject → 활성 안 함
//   4. *수정* 마다 X — 첫 활성 시점만

import { type PluginTrustLevel, type TrustRegistry, policyFor } from "./trust-registry";
import type { Violation } from "./validator";

export interface ConsentPrompt {
  /** dialog 헤더 — plugin 이름. */
  pluginName: string;
  /** AI 가 생성한 한 줄 요약 (없으면 fallback 문구). */
  oneLinerSummary: string;
  /** 전체 코드 본문 — 사용자가 "전체 코드 보기" 토글 시 노출. */
  fullSource: string;
  /** trust level 표시 — 사용자가 'imported' 등을 시각적으로 인지하도록. */
  trustLevel: PluginTrustLevel;
  /** Validator 가 발견한 위반 (없으면 empty). 다이얼로그에 같이 표시. */
  violations: readonly Violation[];
}

export type ConsentDecision = "accept" | "reject" | "skip";

export interface ConsentEvaluation {
  /**
   * 다이얼로그를 띄울지 결정:
   *   - "show": 호출자가 ConsentPrompt 로 UI 다이얼로그 띄움
   *   - "skip-local": local trust 라 동의 불필요, 즉시 활성
   *   - "already-consented": 이미 동의 받음, 즉시 활성
   *   - "unknown-plugin": trust 미등록 — 등록 먼저
   */
  action: "show" | "skip-local" | "already-consented" | "unknown-plugin";
  prompt?: ConsentPrompt;
}

/**
 * plugin 활성 직전 호출. UI 다이얼로그 노출 여부 결정.
 */
export function evaluateConsent(
  pluginName: string,
  registry: TrustRegistry,
  payload: {
    fullSource: string;
    oneLinerSummary: string;
    violations?: readonly Violation[];
  },
): ConsentEvaluation {
  const level = registry.level(pluginName);
  if (!level) return { action: "unknown-plugin" };

  if (level === "local") return { action: "skip-local" };

  if (registry.hasConsent(pluginName)) {
    return { action: "already-consented" };
  }

  return {
    action: "show",
    prompt: {
      pluginName,
      oneLinerSummary: payload.oneLinerSummary || "(요약 없음)",
      fullSource: payload.fullSource,
      trustLevel: level,
      violations: payload.violations ?? [],
    },
  };
}

/**
 * 사용자 결정을 등록에 반영.
 * accept → recordConsent, reject → 아무것도 안 함 (plugin 비활성 유지).
 * skip 은 일반적으로 호출자 측 노옵 — 본 함수는 noop.
 */
export function applyConsentDecision(
  pluginName: string,
  decision: ConsentDecision,
  registry: TrustRegistry,
  now: number,
): { activated: boolean } {
  if (decision === "accept") {
    registry.recordConsent(pluginName, now);
    return { activated: true };
  }
  return { activated: false };
}

/**
 * 사용자에게 보여줄 *위반 요약* 문자열. dialog 본문에 함께 표시.
 */
export function summariseViolations(violations: readonly Violation[]): string {
  if (violations.length === 0) return "위반 사항 없음 (Validator 통과)";
  const lines = violations.map(
    (v) => `- L${v.span.line}:${v.span.column} ${v.code} — ${v.message}`,
  );
  return `Validator 가 ${violations.length}건 발견:\n${lines.join("\n")}`;
}

/**
 * trust level 별 *기본 권장 행동* — UI 의 "수락/거절" 외 추가 안내문.
 */
export function recommendationFor(level: PluginTrustLevel): string {
  const p = policyFor(level);
  if (level === "local") return "본인이 직접 작성. 즉시 활성됩니다.";
  if (level === "llm-generated")
    return "LLM 이 작성한 코드입니다. 전체 코드 확인 후 수락을 권장합니다.";
  // imported
  if (p.sanitizerStrict)
    return "외부 출처입니다. Sanitizer strict 강제 + Validator 적용. 신뢰할 수 있는 origin 인지 확인하세요.";
  return "외부 출처입니다.";
}
