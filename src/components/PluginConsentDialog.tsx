// ADR-0016 T5.F: 신규 파서 활성 시 동의 다이얼로그.
//
// 본 컴포넌트는 src/lib/plugins/runtime/consent.ts 의 evaluateConsent + applyConsentDecision 을 wrap.
// trust level 별 아이콘 + AI 요약 + 전체 코드 + Accept/Reject UI.

import { useState } from "react";
import { useTranslation } from "react-i18next";
import {
  type ConsentDecision,
  type ConsentPrompt,
  recommendationFor,
  summariseViolations,
} from "../lib/plugins/runtime/consent";
import { iconFor } from "../lib/plugins/runtime/trust-registry";
import { Icon } from "./Icon";

interface Props {
  /** evaluateConsent() 의 prompt 결과. null = 다이얼로그 닫힘. */
  prompt: ConsentPrompt | null;
  /** 사용자 결정 → caller 가 applyConsentDecision 호출. */
  onDecision: (decision: ConsentDecision) => void;
}

export function PluginConsentDialog({ prompt, onDecision }: Props): React.ReactElement | null {
  const { t } = useTranslation();
  const [showFullCode, setShowFullCode] = useState(false);

  if (!prompt) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40"
      role="presentation"
      data-testid="plugin-consent-overlay"
    >
      {/* biome-ignore lint/a11y/useSemanticElements: portal-less overlay; div+role=dialog matches the rest of the app */}
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="consent-title"
        className="flex max-h-[80vh] w-[min(640px,92vw)] flex-col overflow-hidden rounded-lg border border-[var(--color-border)] bg-[var(--color-bg)] text-[var(--color-fg)] shadow-2xl"
      >
        <header className="flex items-center justify-between border-[var(--color-border)] border-b px-4 py-3">
          <h2 id="consent-title" className="flex items-center gap-2 font-semibold text-base">
            <span
              aria-label={`trust level: ${prompt.trustLevel}`}
              data-testid="consent-trust-icon"
              className="inline-flex"
            >
              <Icon name={iconFor(prompt.trustLevel)} size={18} />
            </span>
            <span data-testid="consent-plugin-name">{prompt.pluginName}</span>
          </h2>
          <span
            className="rounded bg-[var(--color-border)]/40 px-2 py-0.5 text-[var(--color-muted)] text-xs"
            data-testid="consent-trust-label"
          >
            {prompt.trustLevel}
          </span>
        </header>

        <div className="flex-1 overflow-y-auto px-4 py-3 text-sm">
          <p data-testid="consent-summary" className="mb-3">
            <strong>{t("plugin.consent.summary_label", "요약")}:</strong> {prompt.oneLinerSummary}
          </p>

          <p
            className="mb-3 rounded border border-[var(--color-border)]/60 bg-[var(--color-surface-subtle)] p-2 text-[var(--color-muted)] text-xs"
            data-testid="consent-recommendation"
          >
            {recommendationFor(prompt.trustLevel)}
          </p>

          <div className="mb-3">
            <button
              type="button"
              data-testid="consent-toggle-code"
              className="text-[var(--color-accent)] text-xs underline"
              onClick={() => setShowFullCode((v) => !v)}
            >
              {showFullCode
                ? t("plugin.consent.hide_code", "전체 코드 숨기기")
                : t("plugin.consent.show_code", "전체 코드 보기")}
            </button>
            {showFullCode && (
              <pre
                data-testid="consent-full-code"
                className="mt-2 max-h-64 overflow-auto rounded border border-[var(--color-border)] bg-[var(--color-surface-subtle)] p-2 text-xs"
              >
                <code>{prompt.fullSource}</code>
              </pre>
            )}
          </div>

          {prompt.violations.length > 0 && (
            <pre
              data-testid="consent-violations"
              className="rounded border border-amber-300 bg-amber-50 p-2 text-amber-900 text-xs dark:border-amber-700 dark:bg-amber-950 dark:text-amber-100"
            >
              {summariseViolations(prompt.violations)}
            </pre>
          )}
        </div>

        <footer className="flex items-center justify-end gap-2 border-[var(--color-border)] border-t px-4 py-3">
          <button
            type="button"
            data-testid="consent-reject"
            className="rounded border border-[var(--color-border)] px-3 py-1.5 text-sm hover:bg-[var(--color-border)]/40"
            onClick={() => onDecision("reject")}
          >
            {t("plugin.consent.reject", "거절")}
          </button>
          <button
            type="button"
            data-testid="consent-accept"
            className="rounded bg-[var(--color-accent)] px-3 py-1.5 text-sm text-white hover:opacity-90"
            onClick={() => onDecision("accept")}
          >
            {t("plugin.consent.accept", "수락 + 활성")}
          </button>
        </footer>
      </div>
    </div>
  );
}
