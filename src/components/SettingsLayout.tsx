// S-SBC-003: Layout section — per-workspace sidebar collapsed-mode choice
// (rail vs fully hidden). Only renders when a workspace is open since the
// setting is keyed by workspace path.

import { useTranslation } from "react-i18next";
import { type SidebarCollapsedMode, useLayout } from "../store/layout";
import { useWorkspace } from "../store/workspace";

const MODE_OPTIONS: { value: SidebarCollapsedMode; labelKey: string; fallback: string }[] = [
  { value: "rail", labelKey: "settings.layout.collapsed_mode.rail", fallback: "Slim rail" },
  { value: "hidden", labelKey: "settings.layout.collapsed_mode.hidden", fallback: "Fully hidden" },
];

export function SettingsLayout() {
  const { t } = useTranslation();
  const current = useWorkspace((s) => s.current);
  const mode = useLayout((s) =>
    current ? s.getSidebarCollapsedMode(current) : "rail",
  );
  const setMode = useLayout((s) => s.setSidebarCollapsedMode);

  if (!current) return null;

  return (
    <section
      aria-label={t("settings.layout.title", "Layout")}
      className="flex flex-col gap-3 border-[var(--color-border)] border-b p-4 text-sm"
    >
      <h2 className="font-semibold text-base">
        {t("settings.layout.title", "Layout")}
      </h2>
      <fieldset className="flex flex-col gap-2">
        <legend className="text-xs text-[var(--color-muted)]">
          {t(
            "settings.layout.collapsed_mode.label",
            "When the sidebar is collapsed",
          )}
        </legend>
        <div className="flex gap-2">
          {MODE_OPTIONS.map((opt) => (
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
                name="sidebar-collapsed-mode"
                value={opt.value}
                checked={mode === opt.value}
                onChange={() => setMode(current, opt.value)}
                className="sr-only"
              />
              {t(opt.labelKey, opt.fallback)}
            </label>
          ))}
        </div>
      </fieldset>
    </section>
  );
}
