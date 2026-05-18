import { useTranslation } from "react-i18next";
import { useOnboarding } from "../store/onboarding";

interface WelcomeBannerProps {
  onOpenAiSettings?: () => void;
}

export function WelcomeBanner({ onOpenAiSettings }: WelcomeBannerProps = {}) {
  const { t } = useTranslation();
  const dismissed = useOnboarding((s) => s.welcomeBannerDismissed);
  const dismiss = useOnboarding((s) => s.dismissBanner);
  const startTour = useOnboarding((s) => s.startTour);

  if (dismissed) return null;

  return (
    <div
      className="flex items-center justify-between gap-4 border-[var(--color-border)] border-b bg-[var(--color-accent)]/10 px-4 py-2 text-sm"
      role="region"
      aria-label={t("welcome_banner.aria", "Welcome banner")}
    >
      <div className="flex flex-col">
        <span className="font-medium">{t("welcome_banner.title", "Welcome to Markspread")}</span>
        <span className="text-[var(--color-muted)] text-xs">
          {t(
            "welcome_banner.subtitle",
            "Take a quick tour or set up your AI provider to get started.",
          )}
        </span>
      </div>
      <div className="flex items-center gap-2">
        <button
          type="button"
          className="rounded-md bg-[var(--color-accent)] px-3 py-1 font-medium text-white text-xs hover:opacity-90"
          onClick={startTour}
        >
          {t("welcome_banner.action.tour", "Take the tour")}
        </button>
        <button
          type="button"
          className="rounded-md border border-[var(--color-border)] px-3 py-1 text-xs hover:bg-[var(--color-border)]/30"
          onClick={() => {
            dismiss();
            onOpenAiSettings?.();
          }}
        >
          {t("welcome_banner.action.setup_ai", "Set up AI")}
        </button>
        <button
          type="button"
          className="text-[var(--color-muted)] text-xs hover:underline"
          onClick={dismiss}
          aria-label={t("welcome_banner.action.dismiss_aria", "Dismiss welcome banner")}
        >
          {t("welcome_banner.action.dismiss", "Dismiss")}
        </button>
      </div>
    </div>
  );
}
