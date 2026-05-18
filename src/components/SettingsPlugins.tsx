// S-PLG-* host surface: installed plugins list with toggle + uninstall.
// The marketplace browse/install flow is a separate dialog (the panel
// links out to it).

import { invoke } from "@tauri-apps/api/core";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import type { PluginManifest } from "../lib/plugins/manifest";
import { PluginMarketplace } from "./PluginMarketplace";

interface InstalledPlugin {
  manifest: PluginManifest;
  enabled: boolean;
}

export function SettingsPlugins() {
  const { t } = useTranslation();
  const [plugins, setPlugins] = useState<InstalledPlugin[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [marketOpen, setMarketOpen] = useState(false);

  const refresh = async () => {
    try {
      const list = await invoke<InstalledPlugin[]>("plugin_list");
      setPlugins(list);
    } catch (e) {
      setError(String((e as { message?: string })?.message ?? e));
    }
  };

  useEffect(() => {
    void refresh();
  }, []);

  const setEnabled = async (id: string, enabled: boolean) => {
    try {
      await invoke(enabled ? "plugin_enable" : "plugin_disable", { pluginId: id });
      await refresh();
    } catch (e) {
      setError(String((e as { message?: string })?.message ?? e));
    }
  };

  const uninstall = async (id: string) => {
    try {
      await invoke("plugin_uninstall", { pluginId: id });
      await refresh();
    } catch (e) {
      setError(String((e as { message?: string })?.message ?? e));
    }
  };

  return (
    <section
      aria-label={t("settings.plugins.title", "Plugins")}
      className="flex flex-col gap-3 border-[var(--color-border)] border-b p-4 text-sm"
    >
      <h2 className="font-semibold text-base">{t("settings.plugins.title", "Plugins")}</h2>
      <button
        type="button"
        onClick={() => setMarketOpen(true)}
        className="self-start rounded bg-[var(--color-accent)] px-3 py-1 text-white text-xs"
      >
        {t("settings.plugins.browse", "Browse marketplace")}
      </button>
      <PluginMarketplace
        open={marketOpen}
        onClose={() => {
          setMarketOpen(false);
          void refresh();
        }}
      />
      {error && (
        <p role="alert" className="text-red-500 text-xs">
          {error}
        </p>
      )}
      {plugins.length === 0 ? (
        <p className="text-[var(--color-muted)] text-xs">
          {t("settings.plugins.empty", "No plugins installed.")}
        </p>
      ) : (
        <ul className="flex flex-col gap-1">
          {plugins.map(({ manifest, enabled }) => (
            <li
              key={manifest.id}
              className="flex items-center justify-between gap-2 rounded border border-[var(--color-border)] px-3 py-1.5 text-xs"
            >
              <span className="flex flex-col">
                <span className="font-medium">{manifest.name}</span>
                <span className="text-[var(--color-muted)]">
                  {manifest.id} · v{manifest.version}
                </span>
              </span>
              <span className="flex items-center gap-2">
                <label className="flex items-center gap-1">
                  <input
                    type="checkbox"
                    checked={enabled}
                    onChange={(e) => void setEnabled(manifest.id, e.target.checked)}
                  />
                  <span>{t("settings.plugins.enabled", "Enabled")}</span>
                </label>
                <button
                  type="button"
                  className="text-red-500 hover:underline"
                  onClick={() => void uninstall(manifest.id)}
                >
                  {t("settings.plugins.uninstall", "Uninstall")}
                </button>
              </span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
