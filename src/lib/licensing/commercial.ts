// ADR-0015 §3: Commercial License honor system.
//
// Obsidian-style: 조직 사용 시 $50/y per user 자율 결제. 법적 강제 X.
// 결제 검증은 *honor system* — Stripe Checkout 의 customer/subscription 메타만 저장.
//
// 본 모듈 = TypeScript 측 *상태 + 표시 로직*. 실제 Stripe webhook → 서버 검증은
// 별도 서비스 (markspread-licensing) 가 처리하고 본 도구는 받은 license token 만
// 저장·표시.

export type LicenseTier = "free" | "commercial";

export interface CommercialLicense {
  /** Stripe customer ID (필요 시 결제 페이지 deep link 에 사용) */
  customerId: string;
  /** Stripe subscription ID */
  subscriptionId: string;
  /** 시작 일자 (ISO 8601) */
  startedAt: string;
  /** 다음 결제일 — 만료 표시용 */
  renewsAt: string;
  /** 회사명 (영수증·UI 표시) */
  organization?: string;
  /** 라이선스 ID (마켓 도구·법적 추적) */
  licenseId: string;
}

export interface LicenseStatus {
  tier: LicenseTier;
  /** UI 에 표시할 라벨 */
  label: string;
  /** 만료 임박 (30일 이내) — UI 가 알림 표시 */
  expiresSoon: boolean;
  /** 만료 일자 (commercial 만) */
  expiresOn?: string;
  /** Stripe checkout 또는 portal URL — UI 가 "결제 관리" 버튼 */
  manageUrl: string;
}

export interface LicenseEnv {
  /** 현재 시각 (ISO 8601) — 결정성 위해 외부 주입 */
  now: string;
  /** Stripe portal URL prefix — 보통 markspread.app/license */
  manageBaseUrl: string;
}

/**
 * License 객체 → 사용자 표시용 status.
 * license null = free tier.
 */
export function status(license: CommercialLicense | null, env: LicenseEnv): LicenseStatus {
  if (!license) {
    return {
      tier: "free",
      label: "Free (AGPL-3.0 — 개인 사용)",
      expiresSoon: false,
      manageUrl: env.manageBaseUrl,
    };
  }
  const nowMs = new Date(env.now).getTime();
  const renewMs = new Date(license.renewsAt).getTime();
  const daysToRenew = (renewMs - nowMs) / (1000 * 60 * 60 * 24);

  return {
    tier: "commercial",
    label: license.organization
      ? `Commercial — ${license.organization}`
      : "Commercial License ($50/year)",
    expiresSoon: daysToRenew > 0 && daysToRenew <= 30,
    expiresOn: license.renewsAt,
    manageUrl: `${env.manageBaseUrl}?customer=${encodeURIComponent(license.customerId)}`,
  };
}

/**
 * 조직 사용에 commercial license 가 *권장* 되는가 판단.
 * "조직 사용" 의 신호:
 *   - workspace 가 사용자 home 밖
 *   - 워크스페이스 경로에 "company"/"org"/"team" 포함 (heuristic)
 *   - 그 외 호출자가 명시한 signal
 *
 * honor system — 결정은 사용자에게. UI 가 부드러운 안내만 표시.
 */
export function shouldRecommendCommercial(input: {
  workspacePath: string;
  homePath: string;
  hasUserLicense: boolean;
  explicitOrgFlag?: boolean;
}): boolean {
  if (input.hasUserLicense) return false;
  if (input.explicitOrgFlag === true) return true;
  if (input.explicitOrgFlag === false) return false;
  if (!input.workspacePath.startsWith(input.homePath)) return true;
  const lower = input.workspacePath.toLowerCase();
  return ["company", "/org/", "team", "corp", "enterprise"].some((s) => lower.includes(s));
}

/**
 * UI 의 권장 안내 문구.
 */
export function recommendationMessage(): string {
  return "조직 환경에서 사용 중이라면 Commercial License ($50/년) 결제를 권장합니다. AGPL-3.0 의 honor system 으로 운영됩니다.";
}
