// S-UP-* host surface: current version, channel selection, manual
// "Check now". The auto-update consent toggle stays in the dedicated
// `<AutoUpdateConsent/>` first-run dialog; this panel mirrors the
// stored value so the user can revisit the decision.

import { invoke } from "@tauri-apps/api/core";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  checkForUpdate,
  type UpdateChannel,
} from "../lib/updater/updater";
import { useUpdater } from "../store/updater";

export function SettingsUpdater() {
  const { t } = useTranslation();
  const consent = useUpdater((s) => s.consent);
  const setConsent = useUpdater((s) => s.setConsent);
  const [version, setVersion] = useState<string>("");
  const [channel, setChannel] = useState<UpdateChannel>("stable");
  const [status, setStatus] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    invoke<string>("app_version")
      .then(setVersion)
      .catch(() => setVersion(""));
  }, []);

  const checkNow = async () => {
    setBusy(true);
    setStatus(null);
    try {
      const manifest = await checkForUpdate(channel);
      setStatus(
        manifest
          ? t("settings.updater.found", "Update available: v{{v}}", { v: manifest.version })
          : t("settings.updater.uptodate", "You're on the latest version."),
      );
    } catch (e) {
      setStatus(String((e as { message?: string })?.message ?? e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <section
      aria-label={t("settings.updater.title", "Updates")}
      className="flex flex-col gap-3 border-[var(--color-border)] border-b p-4 text-sm"
    >
      <h2 className="font-semibold text-base">{t("settings.updater.title", "Updates")}</h2>
      <p className="text-[var(--color-muted)] text-xs">
        {t("settings.updater.current", "Current version")}: <span className="font-mono">{version || "—"}</span>
      </p>
      <label className="flex items-center gap-2 text-xs">
        <span className="w-20 text-[var(--color-muted)]">
          {t("settings.updater.channel", "Channel")}
        </span>
        <select
          className="rounded border border-[var(--color-border)] bg-transparent px-2 py-1 text-xs"
          value={channel}
          onChange={(e) => setChannel(e.target.value as UpdateChannel)}
        >
          <option value="stable">Stable</option>
          <option value="beta">Beta</option>
        </select>
      </label>
      <label className="flex items-center gap-2 text-xs">
        <input
          type="checkbox"
          checked={consent === "allow"}
          onChange={(e) => setConsent(e.target.checked ? "allow" : "deny")}
        />
        <span>{t("settings.updater.auto", "Automatically download updates")}</span>
      </label>
      <div className="flex gap-2">
        <button
          type="button"
          disabled={busy}
          onClick={() => void checkNow()}
          className="rounded bg-[var(--color-accent)] px-3 py-1 text-white text-xs disabled:opacity-50"
        >
          {t("settings.updater.check_now", "Check for updates")}
        </button>
      </div>
      {status && <p className="text-[var(--color-muted)] text-xs">{status}</p>}
    </section>
  );
}
