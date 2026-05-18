import { invoke } from "@tauri-apps/api/core";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { useUpdater } from "../store/updater";
import { useFocusTrap } from "../lib/focus-trap";

export function AutoUpdateConsent() {
  const { t } = useTranslation();
  const consent = useUpdater((s) => s.consent);
  const promptShown = useUpdater((s) => s.firstRunPromptShown);
  const setConsent = useUpdater((s) => s.setConsent);
  const [portable, setPortable] = useState<boolean | null>(null);

  useEffect(() => {
    invoke<boolean>("portable_is_active")
      .then(setPortable)
      .catch(() => setPortable(false));
  }, []);

  const open =
    !promptShown && consent === "unset" && portable !== null && portable !== true;
  const trapRef = useFocusTrap<HTMLDivElement>({
    active: open,
    onEscape: () => setConsent("deny"),
  });

  if (promptShown || consent !== "unset" || portable === null) return null;

  if (portable) {
    setConsent("deny");
    return null;
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40"
      role="dialog"
      aria-modal="true"
      aria-label={t("auto_update.aria", "Auto-update consent")}
    >
      <div
        ref={trapRef}
        className="w-full max-w-md rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] p-6 shadow-xl"
      >
        <h2 className="font-semibold text-base">
          {t("auto_update.headline", "Enable automatic updates?")}
        </h2>
        <p className="mt-2 text-[var(--color-muted)] text-sm">
          {t(
            "auto_update.body",
            "New versions will be downloaded and installed in the background. You can turn this off in Settings at any time.",
          )}
        </p>
        <div className="mt-6 flex justify-end gap-2">
          <button
            type="button"
            className="rounded-md border border-[var(--color-border)] px-4 py-2 text-sm hover:bg-[var(--color-border)]/30"
            onClick={() => setConsent("deny")}
          >
            {t("auto_update.deny", "Decline")}
          </button>
          <button
            type="button"
            className="rounded-md bg-[var(--color-accent)] px-4 py-2 font-medium text-sm text-white hover:opacity-90"
            onClick={() => {
              setConsent("allow");
              // S-UP-001/T-U17-001-FIX-C: don't wait for the next 6h
              // poll tick — fire an immediate check so a user who just
              // opted in sees the download start without lag.
              void import("../lib/updater/updater").then(async ({ checkForUpdate, startDownload }) => {
                try {
                  const manifest = await checkForUpdate("stable");
                  if (manifest) await startDownload(manifest);
                } catch (e) {
                  console.warn("[updater/consent] immediate check failed", e);
                }
              });
            }}
            autoFocus
          >
            {t("auto_update.allow", "Allow")}
          </button>
        </div>
      </div>
    </div>
  );
}
