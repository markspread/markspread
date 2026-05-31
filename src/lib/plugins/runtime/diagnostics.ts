// ADR-0013 T1.b: Plugin 진단 패널의 *데이터 API*.
//
// Default off (CONTEXT.md §6.3) — 설정 toggle 로 노출. 노출 시 UI 가 본 함수 호출.
// 본 모듈은 *순수 logic* — UI 컴포넌트는 별도.

import type { PluginOrchestrator } from "./orchestrator";
import { type PluginTrustIconName, type PluginTrustLevel, iconFor } from "./trust-registry";

export interface PluginDiagnosticEntry {
  pluginName: string;
  trustLevel: PluginTrustLevel;
  trustIcon: PluginTrustIconName;
  hasConsent: boolean;
  authoredBy?: string;
  origin?: string;
  assignedAt: number;
  consentedAt?: number;
}

export interface DiagnosticSnapshot {
  /** UI 가 default off 인지 확인 */
  enabled: boolean;
  /** 등록된 plugin 전체 */
  plugins: readonly PluginDiagnosticEntry[];
  /** UI helper — "registered N plugins" 형태 */
  summary: string;
}

/**
 * 사용자가 설정에서 진단 패널을 toggle on 했을 때 호출.
 * orchestrator 상태 → snapshot.
 */
export function snapshot(orchestrator: PluginOrchestrator, enabled: boolean): DiagnosticSnapshot {
  if (!enabled) {
    return { enabled: false, plugins: [], summary: "diagnostic panel off" };
  }
  const entries = orchestrator.trust.list().map((e): PluginDiagnosticEntry => {
    const out: PluginDiagnosticEntry = {
      pluginName: e.pluginName,
      trustLevel: e.level,
      trustIcon: iconFor(e.level),
      hasConsent: orchestrator.trust.hasConsent(e.pluginName),
      assignedAt: e.assignedAt,
    };
    if (e.authoredBy !== undefined) out.authoredBy = e.authoredBy;
    if (e.origin !== undefined) out.origin = e.origin;
    if (e.consentedAt !== undefined) out.consentedAt = e.consentedAt;
    return out;
  });
  return {
    enabled: true,
    plugins: entries,
    summary: `${entries.length} plugin(s) registered`,
  };
}

/**
 * 단일 plugin 의 상세 — UI 가 entry 클릭 시 호출.
 */
export function detail(
  orchestrator: PluginOrchestrator,
  pluginName: string,
): PluginDiagnosticEntry | null {
  const all = snapshot(orchestrator, true).plugins;
  return all.find((p) => p.pluginName === pluginName) ?? null;
}
