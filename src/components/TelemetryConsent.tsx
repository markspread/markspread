import { useTranslation } from "react-i18next";
import { useFocusTrap } from "../lib/focus-trap";
import { isTauriRuntime } from "../lib/runtime";
import { useTelemetry } from "../store/telemetry";
import { useUpdater } from "../store/updater";

const SAMPLE_REPORT = `{
  "id": "<uuid>",
  "version": "0.1.0",
  "os": "macOS 14.5 arm64",
  "stack": [
    "core::fs_cmd::fs_read",
    "tokio::fs::File::open",
    "io::ErrorKind::PermissionDenied"
  ]
}`;

export function TelemetryConsent() {
  const { t } = useTranslation();
  const consent = useTelemetry((s) => s.consent);
  const promptShown = useTelemetry((s) => s.firstRunPromptShown);
  const setConsent = useTelemetry((s) => s.setConsent);

  // Show only after the updater consent has been resolved, so dialogs don't
  // stack on top of each other.
  const updaterPromptShown = useUpdater((s) => s.firstRunPromptShown);

  const open = isTauriRuntime() && !promptShown && consent === "unset" && updaterPromptShown;
  // Esc dismisses with the conservative "disabled" choice — we never want to
  // imply opt-in via keyboard accident.
  const trapRef = useFocusTrap<HTMLDivElement>({
    active: open,
    onEscape: () => setConsent("disabled"),
  });

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40"
      // biome-ignore lint/a11y/useSemanticElements: dialog overlay keeps div for layout/portal control
      role="dialog"
      aria-modal="true"
      aria-label={t("telemetry.aria", "Anonymous usage statistics consent")}
    >
      <div
        ref={trapRef}
        className="w-full max-w-md rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] p-6 shadow-xl"
      >
        <h2 className="font-semibold text-base">
          {t("telemetry.headline", "Send anonymous usage statistics?")}
        </h2>
        <p className="mt-2 text-[var(--color-muted)] text-sm">
          {t(
            "telemetry.body",
            "We collect non-personal usage patterns to improve Markspread. You can turn this off in Settings at any time.",
          )}
        </p>
        <details className="mt-4 rounded-md bg-[var(--color-surface-subtle)] p-3 text-xs">
          <summary className="cursor-pointer text-[var(--color-muted)]">
            {t("telemetry.sample", "Show sample report")}
          </summary>
          <pre className="mt-2 overflow-auto whitespace-pre-wrap font-mono text-[10px]">
            {SAMPLE_REPORT}
          </pre>
        </details>
        <div className="mt-6 flex justify-end gap-2">
          <button
            type="button"
            className="rounded-md border border-[var(--color-border)] px-4 py-2 text-sm hover:bg-[var(--color-border)]/30"
            onClick={() => setConsent("disabled")}
          >
            {t("telemetry.disable", "Don't send")}
          </button>
          <button
            type="button"
            className="rounded-md bg-[var(--color-accent)] px-4 py-2 font-medium text-sm text-white hover:opacity-90"
            onClick={() => setConsent("enabled")}
          >
            {t("telemetry.enable", "Send")}
          </button>
        </div>
      </div>
    </div>
  );
}
