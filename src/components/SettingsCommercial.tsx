// ADR-0015 §3: Commercial License honor system settings panel.
//
// 사용자가 조직 환경에 있다면 권장 안내 + Stripe checkout URL 노출.
// 본 컴포넌트는 src/lib/licensing/commercial.ts 의 logic 을 wrap.

import { useTranslation } from "react-i18next";
import {
  type CommercialLicense,
  type LicenseEnv,
  recommendationMessage,
  status,
} from "../lib/licensing/commercial";

interface Props {
  /** 실제 license — null 이면 Free tier 표시. 호출자가 Stripe 결제 완료 후 주입. */
  license?: CommercialLicense | null;
  /** 권장 안내 표시 여부 (caller 가 shouldRecommendCommercial() 호출 결과). */
  recommend?: boolean;
  /** UTC ISO 8601 timestamp — 테스트 결정성 위해 prop 으로 주입 가능. */
  now?: string;
  /** Stripe portal base URL — default markspread.app */
  manageBaseUrl?: string;
}

export function SettingsCommercial({
  license = null,
  recommend = false,
  now,
  manageBaseUrl = "https://markspread.app/license",
}: Props): React.ReactElement {
  const { t } = useTranslation();
  const env: LicenseEnv = {
    now: now ?? new Date().toISOString(),
    manageBaseUrl,
  };
  const s = status(license, env);

  return (
    <section
      aria-label={t("settings.commercial.title", "License")}
      className="flex flex-col gap-3 border-[var(--color-border)] border-b p-4 text-sm"
    >
      <h2 className="font-semibold text-base">{t("settings.commercial.title", "License")}</h2>
      <div className="flex flex-col gap-1">
        <div className="flex items-center gap-2">
          <span
            className={`rounded px-2 py-0.5 text-xs ${
              s.tier === "commercial"
                ? "bg-[var(--color-accent)]/20 text-[var(--color-accent)]"
                : "bg-[var(--color-border)]/40 text-[var(--color-muted)]"
            }`}
            data-testid="commercial-tier-badge"
          >
            {s.tier === "commercial" ? "Commercial" : "Free"}
          </span>
          <span className="text-[var(--color-muted)]">{s.label}</span>
        </div>
        {s.expiresSoon && s.expiresOn && (
          <div
            className="text-xs text-amber-600 dark:text-amber-400"
            data-testid="commercial-expires-soon"
          >
            {t("settings.commercial.expires_soon", "Renews on")}{" "}
            <time dateTime={s.expiresOn}>{s.expiresOn.slice(0, 10)}</time>
          </div>
        )}
      </div>
      {recommend && s.tier === "free" && (
        <div
          className="rounded border border-amber-300 bg-amber-50 p-3 text-xs text-amber-900 dark:border-amber-700 dark:bg-amber-950 dark:text-amber-100"
          data-testid="commercial-recommend"
        >
          {recommendationMessage()}
        </div>
      )}
      <a
        href={s.manageUrl}
        target="_blank"
        rel="noopener noreferrer"
        className="inline-block self-start rounded border border-[var(--color-border)] px-3 py-1.5 text-xs hover:bg-[var(--color-border)]/40"
        data-testid="commercial-manage-link"
      >
        {s.tier === "commercial"
          ? t("settings.commercial.manage", "라이선스 관리")
          : t("settings.commercial.purchase", "Commercial License 구매")}
      </a>
      <p className="text-[var(--color-muted)] text-xs">
        {t(
          "settings.commercial.honor_system",
          "AGPL-3.0 honor system. 법적 강제 X. $50/year per user.",
        )}
      </p>
    </section>
  );
}
