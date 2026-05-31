// ADR-0016 (T5.G): 파서 trust level 레지스트리.
//
// 3단계:
//   - local         (사용자 본인 직접 작성, 모든 권한, 활성 다이얼로그 skip)
//   - llm-generated (LLM 작성, 다층 방어 적용 — Validator + Sanitizer + BudgetGuard + 활성 동의)
//   - imported      (외부 import, llm-generated + 더 엄격 — Sanitizer strict 강제)
//
// UI: 트리·플러그인 패널에 미니 아이콘 (lock-open / bot / shield) — IconName for Icon.tsx.

export type PluginTrustLevel = "local" | "llm-generated" | "imported";

export interface PluginTrustEntry {
  /** plugin manifest.name */
  pluginName: string;
  level: PluginTrustLevel;
  /** Unix ms — 처음 등록된 시각 */
  assignedAt: number;
  /** 사용자가 활성 동의를 마친 시각 (없으면 미동의) */
  consentedAt?: number;
  /** llm-generated 경우 — 어느 model 이 생성했는지 (telemetry/audit) */
  authoredBy?: string;
  /** imported 경우 — origin URL 또는 source */
  origin?: string;
}

/**
 * 다음 정책 결정 (Validator/Sanitizer/BudgetGuard/활성 동의가 호출).
 */
export interface PluginSafetyPolicy {
  /** Validator (AST) 적용? */
  validateAst: boolean;
  /** Sanitizer 강제 strict? (false = 사용자 토글 가능) */
  sanitizerStrict: boolean;
  /** 활성 동의 다이얼로그 필요? */
  requireConsent: boolean;
  /** Idle suspend 짧게? (imported = 더 빨리 회수) */
  shortIdle: boolean;
}

export function policyFor(level: PluginTrustLevel): PluginSafetyPolicy {
  switch (level) {
    case "local":
      return {
        validateAst: false,
        sanitizerStrict: false,
        requireConsent: false,
        shortIdle: false,
      };
    case "llm-generated":
      return {
        validateAst: true,
        sanitizerStrict: false,
        requireConsent: true,
        shortIdle: false,
      };
    case "imported":
      return {
        validateAst: true,
        sanitizerStrict: true,
        requireConsent: true,
        shortIdle: true,
      };
  }
}

/** UI 아이콘 매핑 — IconName from components/Icon.tsx. */
export type PluginTrustIconName = "lock" | "bot" | "shield";

export function iconFor(level: PluginTrustLevel): PluginTrustIconName {
  if (level === "local") return "lock";
  if (level === "llm-generated") return "bot";
  return "shield";
}

/** 인-메모리 + persistence-friendly 레지스트리. 호출자가 직렬화를 책임. */
export class TrustRegistry {
  private readonly map = new Map<string, PluginTrustEntry>();

  size(): number {
    return this.map.size;
  }

  /**
   * 새 plugin 의 trust level 등록.
   * 이미 등록된 plugin 의 재등록은 *upgrade only* (less strict → more strict 만 허용).
   * imported → local 같은 다운그레이드는 거부 (사용자 명시 reset() 필요).
   */
  register(
    pluginName: string,
    level: PluginTrustLevel,
    opts: { authoredBy?: string; origin?: string; now: number } = { now: 0 },
  ): PluginTrustEntry {
    const existing = this.map.get(pluginName);
    if (existing) {
      // 같은 레벨이면 그대로
      if (existing.level === level) return existing;
      // 다운그레이드 방지
      if (compareStrictness(level, existing.level) < 0) {
        throw new Error(
          `cannot downgrade trust for "${pluginName}": ${existing.level} → ${level}. use reset() first`,
        );
      }
    }
    const entry: PluginTrustEntry = {
      pluginName,
      level,
      assignedAt: opts.now,
    };
    if (opts.authoredBy !== undefined) entry.authoredBy = opts.authoredBy;
    if (opts.origin !== undefined) entry.origin = opts.origin;
    this.map.set(pluginName, entry);
    return entry;
  }

  /** 사용자가 활성 동의 다이얼로그를 Accept 했을 때 호출. */
  recordConsent(pluginName: string, now: number): PluginTrustEntry {
    const entry = this.map.get(pluginName);
    if (!entry) throw new Error(`unknown plugin: ${pluginName}`);
    entry.consentedAt = now;
    return entry;
  }

  /** 동의 여부 확인 — local 은 항상 true 로 처리. */
  hasConsent(pluginName: string): boolean {
    const entry = this.map.get(pluginName);
    if (!entry) return false;
    if (entry.level === "local") return true;
    return typeof entry.consentedAt === "number";
  }

  /** plugin 의 trust level (없으면 null). */
  level(pluginName: string): PluginTrustLevel | null {
    return this.map.get(pluginName)?.level ?? null;
  }

  /** plugin 의 정책 — level 기반 derive. plugin 없으면 가장 strict (imported). */
  policy(pluginName: string): PluginSafetyPolicy {
    return policyFor(this.level(pluginName) ?? "imported");
  }

  /** 완전 reset — trust level 변경 또는 plugin 삭제 시. */
  reset(pluginName: string): void {
    this.map.delete(pluginName);
  }

  /** 전체 entry 스냅샷 — persistence·UI 리스트용. */
  list(): readonly PluginTrustEntry[] {
    return Array.from(this.map.values()).map((e) => ({ ...e }));
  }
}

/**
 * 더 엄격한 레벨이 더 큰 값.
 *   local < llm-generated < imported
 * register() 의 업그레이드 정책에서 사용.
 */
function compareStrictness(a: PluginTrustLevel, b: PluginTrustLevel): number {
  const rank: Record<PluginTrustLevel, number> = {
    local: 0,
    "llm-generated": 1,
    imported: 2,
  };
  return rank[a] - rank[b];
}
