// S-ST-002: app-level Settings dialog. Wraps the existing SettingsAppearance
// panel and adds a Theme section bound to useTheme. Modal pattern (backdrop +
// ESC + outside-click) so the file tree / editor stay reachable visually but
// inert until the sheet closes.

import { useEffect, useRef } from "react";
import { useTranslation } from "react-i18next";
import type { ThemeMode } from "../lib/theme";
import { useTheme } from "../store/theme";
import { useSettingsSheet } from "../store/settings-sheet";
import { SettingsAi } from "./SettingsAi";
import { SettingsAppearance } from "./SettingsAppearance";
import { SettingsBackup } from "./SettingsBackup";
import { SettingsDiagnostics } from "./SettingsDiagnostics";
import { SettingsKeybindings } from "./SettingsKeybindings";
import { SettingsLayout } from "./SettingsLayout";
import { SettingsPlugins } from "./SettingsPlugins";
import { SettingsSecurity } from "./SettingsSecurity";
import { SettingsUpdater } from "./SettingsUpdater";

const THEME_OPTIONS: { value: ThemeMode; labelKey: string; fallback: string }[] = [
  { value: "system", labelKey: "settings.theme.mode.system", fallback: "System" },
  { value: "light",  labelKey: "settings.theme.mode.light",  fallback: "Light"  },
  { value: "dark",   labelKey: "settings.theme.mode.dark",   fallback: "Dark"   },
];

export function SettingsSheet() {
  const { t } = useTranslation();
  const open = useSettingsSheet((s) => s.open);
  const hide = useSettingsSheet((s) => s.hide);
  const mode = useTheme((s) => s.mode);
  const setMode = useTheme((s) => s.setMode);
  const dialogRef = useRef<HTMLDivElement | null>(null);

  // ESC closes; focus the dialog so screen readers land inside.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.stopPropagation();
        hide();
      }
    };
    window.addEventListener("keydown", onKey);
    dialogRef.current?.focus();
    return () => window.removeEventListener("keydown", onKey);
  }, [open, hide]);

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 flex items-center justify-center bg-black/40"
      style={{ zIndex: "var(--z-sheet)" }}
      role="presentation"
      onClick={(e) => {
        if (e.target === e.currentTarget) hide();
      }}
    >
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-label={t("settings.sheet.title", "Settings")}
        tabIndex={-1}
        className="flex max-h-[80vh] w-[min(560px,90vw)] flex-col overflow-hidden rounded-lg border border-[var(--color-border)] bg-[var(--color-bg)] text-[var(--color-fg)] shadow-2xl outline-none"
      >
        <header className="flex items-center justify-between border-[var(--color-border)] border-b px-4 py-2.5">
          <h1 className="font-semibold text-base">
            {t("settings.sheet.title", "Settings")}
          </h1>
          <button
            type="button"
            onClick={hide}
            aria-label={t("settings.sheet.close", "Close settings")}
            className="rounded px-2 py-0.5 text-[var(--color-muted)] text-sm hover:bg-[var(--color-border)]/40"
          >
            ✕
          </button>
        </header>
        <div className="flex-1 overflow-y-auto">
          <section
            aria-label={t("settings.theme.title", "Theme")}
            className="flex flex-col gap-3 border-[var(--color-border)] border-b p-4 text-sm"
          >
            <h2 className="font-semibold text-base">
              {t("settings.theme.title", "Theme")}
            </h2>
            <fieldset className="flex flex-col gap-1">
              <legend className="sr-only">
                {t("settings.theme.title", "Theme")}
              </legend>
              <div className="flex gap-2">
                {THEME_OPTIONS.map((opt) => (
                  <label
                    key={opt.value}
                    className={`cursor-pointer rounded border px-3 py-1.5 text-xs ${
                      mode === opt.value
                        ? "border-[var(--color-accent)] bg-[var(--color-accent)]/10"
                        : "border-[var(--color-border)] hover:bg-[var(--color-border)]/40"
                    }`}
                  >
                    <input
                      type="radio"
                      name="theme-mode"
                      value={opt.value}
                      checked={mode === opt.value}
                      onChange={() => setMode(opt.value)}
                      className="sr-only"
                    />
                    {t(opt.labelKey, opt.fallback)}
                  </label>
                ))}
              </div>
            </fieldset>
          </section>
          <SettingsAppearance />
          <SettingsLayout />
          <SettingsAi />
          <SettingsKeybindings />
          <SettingsBackup />
          <SettingsPlugins />
          <SettingsUpdater />
          <SettingsSecurity />
          <SettingsDiagnostics />
        </div>
      </div>
    </div>
  );
}
