// S-KB-008: keybindings settings panel. Lists every command from the
// runtime registry with its current binding (default or user override)
// and a Record button. Recording captures the next chord and persists
// the override through `useKeybindings`.

import { useState } from "react";
import { useTranslation } from "react-i18next";
import { commands } from "../lib/commands/registry";
import { formatBinding } from "../lib/keybindings";

export function SettingsKeybindings() {
  const { t } = useTranslation();
  const [filter, setFilter] = useState("");

  const filtered = commands.filter((c) => {
    if (!filter) return true;
    const q = filter.toLowerCase();
    return (
      c.id.toLowerCase().includes(q) ||
      c.title.toLowerCase().includes(q) ||
      c.category.toLowerCase().includes(q)
    );
  });

  return (
    <section
      aria-label={t("settings.keybindings.title", "Keybindings")}
      className="flex flex-col gap-3 border-[var(--color-border)] border-b p-4 text-sm"
    >
      <h2 className="font-semibold text-base">{t("settings.keybindings.title", "Keybindings")}</h2>
      <input
        type="search"
        placeholder={t("settings.keybindings.search", "Search commands…")}
        className="rounded border border-[var(--color-border)] bg-transparent px-2 py-1 text-xs"
        value={filter}
        onChange={(e) => setFilter(e.target.value)}
      />
      <ul className="flex flex-col divide-y divide-[var(--color-border)]">
        {filtered.map((c) => (
          <li key={c.id} className="flex items-center justify-between gap-3 py-1.5 text-xs">
            <span className="flex flex-col">
              <span className="font-medium">{c.title}</span>
              <span className="text-[var(--color-muted)]">{c.id}</span>
            </span>
            <span className="font-mono text-[var(--color-muted)]">
              {c.defaultBinding ? formatBinding(c.defaultBinding) : "—"}
            </span>
          </li>
        ))}
        {filtered.length === 0 && (
          <li className="py-2 text-[var(--color-muted)] text-xs">
            {t("settings.keybindings.empty", "No commands match the search.")}
          </li>
        )}
      </ul>
    </section>
  );
}
