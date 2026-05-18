import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { useOnboarding } from "../store/onboarding";

const IDLE_DELAY_MS = 30_000;

export function ShortcutHint() {
  const { t } = useTranslation();
  const dismissed = useOnboarding((s) => s.shortcutHintDismissed);
  const dismiss = useOnboarding((s) => s.dismissShortcutHint);
  const bannerActive = useOnboarding((s) => !s.welcomeBannerDismissed && !s.tourCompleted);
  const tourActive = useOnboarding((s) => s.tourStep !== null);
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    if (dismissed || bannerActive || tourActive) return;
    const timer = window.setTimeout(() => setVisible(true), IDLE_DELAY_MS);
    function onKey(e: KeyboardEvent) {
      window.clearTimeout(timer);
      const isPalette = (e.metaKey || e.ctrlKey) && e.key === "/";
      if (isPalette) {
        dismiss();
        setVisible(false);
      }
    }
    window.addEventListener("keydown", onKey);
    return () => {
      window.clearTimeout(timer);
      window.removeEventListener("keydown", onKey);
    };
  }, [dismissed, bannerActive, tourActive, dismiss]);

  if (dismissed || !visible || bannerActive || tourActive) return null;

  return (
    <output
      className="fixed right-4 bottom-4 flex items-center gap-3 rounded-md border border-[var(--color-border)] bg-[var(--color-surface-subtle)] px-3 py-2 text-xs shadow-lg"
      aria-label={t("shortcut_hint.aria", "Keyboard shortcut hint")}
    >
      <span>{t("shortcut_hint.message", "Press to open the command palette")}</span>
      <kbd className="rounded border border-[var(--color-border)] px-1">⌘/</kbd>
      <button
        type="button"
        className="text-[var(--color-muted)] hover:underline"
        onClick={() => {
          dismiss();
          setVisible(false);
        }}
        aria-label={t("shortcut_hint.dismiss_aria", "Dismiss shortcut hint")}
      >
        {t("shortcut_hint.dismiss", "Got it")}
      </button>
    </output>
  );
}
