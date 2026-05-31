// ADR-0013 T1.b + ADR-0016 T5.G: Plugin trust diagnostic 시각화.
//
// 본 컴포넌트는 src/lib/plugins/runtime/diagnostics.ts 의 snapshot() 을 wrap.
// SettingsPlugins 안의 sub-section 으로 통합 가능.
//
// default off (CONTEXT.md §6.3) — 사용자가 toggle 클릭해야 노출.

import { useState } from "react";
import { useTranslation } from "react-i18next";
import type { DiagnosticSnapshot } from "../lib/plugins/runtime/diagnostics";
import { Icon } from "./Icon";

interface Props {
  /** snapshot() 결과 — caller (parent) 가 orchestrator 보유. */
  snapshot?: DiagnosticSnapshot;
  /** 초기 활성 상태 — true = panel 노출. */
  initiallyExpanded?: boolean;
}

const EMPTY: DiagnosticSnapshot = {
  enabled: false,
  plugins: [],
  summary: "no orchestrator",
};

export function PluginTrustDiagnostics({
  snapshot = EMPTY,
  initiallyExpanded = false,
}: Props): React.ReactElement {
  const { t } = useTranslation();
  const [expanded, setExpanded] = useState(initiallyExpanded);

  return (
    <section
      aria-label={t("plugin.trust_diag.title", "Plugin trust diagnostics")}
      className="flex flex-col gap-2 border-[var(--color-border)] border-b p-4 text-sm"
      data-testid="plugin-trust-diagnostics"
    >
      <header className="flex items-center justify-between">
        <h3 className="font-semibold text-base">{t("plugin.trust_diag.title", "Plugin Trust")}</h3>
        <button
          type="button"
          data-testid="trust-diag-toggle"
          aria-expanded={expanded}
          className="rounded border border-[var(--color-border)] px-2 py-0.5 text-xs hover:bg-[var(--color-border)]/40"
          onClick={() => setExpanded((v) => !v)}
        >
          {expanded ? t("common.hide", "숨기기") : t("common.show", "보기")}
        </button>
      </header>
      {expanded && (
        <div data-testid="trust-diag-body">
          <p className="text-[var(--color-muted)] text-xs">{snapshot.summary}</p>
          {snapshot.plugins.length === 0 ? (
            <p className="mt-2 text-[var(--color-muted)] text-xs italic">
              {t("plugin.trust_diag.empty", "활성 플러그인 없음")}
            </p>
          ) : (
            <ul className="mt-2 flex flex-col gap-1" data-testid="trust-diag-list">
              {snapshot.plugins.map((p) => (
                <li
                  key={p.pluginName}
                  className="flex items-center gap-2 rounded border border-[var(--color-border)]/40 px-2 py-1 text-xs"
                  data-testid={`trust-diag-row-${p.pluginName}`}
                >
                  <span aria-label={`trust: ${p.trustLevel}`} className="inline-flex">
                    <Icon name={p.trustIcon} size={12} />
                  </span>
                  <span className="flex-1 truncate font-medium">{p.pluginName}</span>
                  <span
                    className={`rounded px-1.5 py-0.5 text-[10px] ${
                      p.hasConsent
                        ? "bg-emerald-100 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300"
                        : "bg-amber-100 text-amber-700 dark:bg-amber-950 dark:text-amber-300"
                    }`}
                  >
                    {p.hasConsent
                      ? t("plugin.trust_diag.consented", "동의됨")
                      : t("plugin.trust_diag.pending", "동의 대기")}
                  </span>
                  <span className="text-[var(--color-muted)]">{p.trustLevel}</span>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </section>
  );
}
