// S-FAP-009: Diagnostics section — opt-in access-decision telemetry.
//
// Lets the user enable local-only counting of file-access denials, browse the
// last 30 days of counts (date × category × rule_id), and clear the local
// store. The four backend commands live in `src-tauri/src/telemetry/mod.rs`.

import { invoke } from "@tauri-apps/api/core";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import type { AccessCategory, RuleId } from "../lib/access-policy/types";

interface AccessStatRow {
  date: string;
  category: AccessCategory;
  ruleId: RuleId;
  count: number;
}

interface TelemetrySettings {
  enabled: boolean;
}

export function SettingsDiagnostics() {
  const { t } = useTranslation();
  const [enabled, setEnabled] = useState<boolean | null>(null);
  const [rows, setRows] = useState<AccessStatRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refresh = async () => {
    setLoading(true);
    setError(null);
    try {
      const settings = await invoke<TelemetrySettings>("telemetry_access_get");
      setEnabled(settings.enabled);
      const data = await invoke<AccessStatRow[]>("telemetry_access_query", { days: 30 });
      setRows(data);
    } catch (e) {
      setError(String((e as { message?: string })?.message ?? e));
    } finally {
      setLoading(false);
    }
  };

  // biome-ignore lint/correctness/useExhaustiveDependencies: one-shot mount-time fetch; refresh is a stable closure over store setters and we don't want it to re-run on every render.
  useEffect(() => {
    void refresh();
  }, []);

  const onToggle = async (next: boolean) => {
    try {
      await invoke("telemetry_access_set", { enabled: next });
      setEnabled(next);
    } catch (e) {
      setError(String((e as { message?: string })?.message ?? e));
    }
  };

  const onClear = async () => {
    try {
      await invoke("telemetry_access_clear");
      setRows([]);
    } catch (e) {
      setError(String((e as { message?: string })?.message ?? e));
    }
  };

  return (
    <section
      aria-label={t("settings.diagnostics.title", "Diagnostics")}
      className="flex flex-col gap-3 border-[var(--color-border)] border-b p-4 text-sm"
    >
      <h2 className="font-semibold text-base">{t("settings.diagnostics.title", "Diagnostics")}</h2>
      <p className="text-[var(--color-muted)] text-xs">
        {t(
          "settings.diagnostics.description",
          "Local-only counters of access-policy denials. Data never leaves this device.",
        )}
      </p>
      <label className="flex items-center gap-2">
        <input
          type="checkbox"
          checked={enabled === true}
          disabled={enabled === null}
          onChange={(e) => void onToggle(e.target.checked)}
        />
        <span>{t("settings.diagnostics.opt_in", "Record access-policy denials locally")}</span>
      </label>

      {error && (
        <p role="alert" className="text-[var(--color-error)] text-xs">
          {error}
        </p>
      )}

      <div className="flex items-center justify-between">
        <span className="font-medium text-xs">
          {t("settings.diagnostics.window", "Last 30 days")}
        </span>
        <div className="flex gap-2">
          <button
            type="button"
            onClick={() => void refresh()}
            disabled={loading}
            className="rounded border border-[var(--color-border)] px-2 py-0.5 text-xs hover:bg-[var(--color-border)]/40 disabled:opacity-50"
          >
            {t("settings.diagnostics.refresh", "Refresh")}
          </button>
          <button
            type="button"
            onClick={() => void onClear()}
            disabled={loading || rows.length === 0}
            className="rounded border border-[var(--color-border)] px-2 py-0.5 text-xs hover:bg-[var(--color-border)]/40 disabled:opacity-50"
          >
            {t("settings.diagnostics.clear", "Clear")}
          </button>
        </div>
      </div>

      {rows.length === 0 ? (
        <p className="text-[var(--color-muted)] text-xs">
          {enabled
            ? t("settings.diagnostics.empty", "No denials recorded yet.")
            : t("settings.diagnostics.disabled", "Recording is disabled.")}
        </p>
      ) : (
        <div className="max-h-48 overflow-y-auto rounded border border-[var(--color-border)]">
          <table className="w-full text-xs">
            <thead className="sticky top-0 bg-[var(--color-bg)]">
              <tr className="border-[var(--color-border)] border-b text-left">
                <th className="px-2 py-1">{t("settings.diagnostics.col.date", "Date")}</th>
                <th className="px-2 py-1">{t("settings.diagnostics.col.category", "Category")}</th>
                <th className="px-2 py-1">{t("settings.diagnostics.col.rule", "Rule")}</th>
                <th className="px-2 py-1 text-right">
                  {t("settings.diagnostics.col.count", "Count")}
                </th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r, i) => (
                <tr
                  key={`${r.date}-${r.category}-${r.ruleId}-${i}`}
                  className="border-[var(--color-border)] border-b last:border-b-0"
                >
                  <td className="px-2 py-1 font-mono">{r.date}</td>
                  <td className="px-2 py-1">{r.category}</td>
                  <td className="px-2 py-1 font-mono">{r.ruleId}</td>
                  <td className="px-2 py-1 text-right tabular-nums">{r.count}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
