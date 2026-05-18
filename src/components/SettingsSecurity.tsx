// S-SEC-014: "Erase all data" — irreversible local wipe.
//
// Calling `security_erase_all_data` blows away local snapshots,
// preferences, the keychain entries for AI keys, and the workspace
// state stores. The button below funnels the user through an explicit
// confirmation gate so it can't be triggered by an errant click.

import { invoke } from "@tauri-apps/api/core";
import { useState } from "react";
import { useTranslation } from "react-i18next";

export function SettingsSecurity() {
  const { t } = useTranslation();
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const erase = async () => {
    setBusy(true);
    setError(null);
    try {
      await invoke("security_erase_all_data");
      window.location.reload();
    } catch (e) {
      setError(String((e as { message?: string })?.message ?? e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <section
      aria-label={t("settings.security.title", "Security")}
      className="flex flex-col gap-3 border-[var(--color-border)] border-b p-4 text-sm"
    >
      <h2 className="font-semibold text-base">{t("settings.security.title", "Security")}</h2>
      <p className="text-[var(--color-muted)] text-xs">
        {t(
          "settings.security.erase_help",
          "Removes all local preferences, snapshots, and keychain entries from this device. Cannot be undone.",
        )}
      </p>
      {error && (
        <p role="alert" className="text-red-500 text-xs">
          {error}
        </p>
      )}
      {!confirming ? (
        <button
          type="button"
          onClick={() => setConfirming(true)}
          className="self-start rounded border border-red-500 px-3 py-1 text-red-500 text-xs hover:bg-red-500/10"
        >
          {t("settings.security.erase", "Erase all data…")}
        </button>
      ) : (
        <div className="flex gap-2">
          <button
            type="button"
            disabled={busy}
            onClick={() => void erase()}
            className="rounded bg-red-500 px-3 py-1 text-white text-xs disabled:opacity-50"
          >
            {t("settings.security.confirm", "Yes, erase everything")}
          </button>
          <button
            type="button"
            disabled={busy}
            onClick={() => setConfirming(false)}
            className="rounded border border-[var(--color-border)] px-3 py-1 text-xs"
          >
            {t("settings.security.cancel", "Cancel")}
          </button>
        </div>
      )}
    </section>
  );
}
