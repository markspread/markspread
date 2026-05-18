// S-KB-009: status-bar indicator that shows the armed chord prefix
// while the chord engine is waiting for the next key. The component
// renders nothing when no chord is pending — drop it anywhere in the
// status bar and it costs zero pixels until a chord starts.

import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";

import { formatBinding } from "@/lib/keybindings";
import { onChordPrefix } from "@/lib/keybindings/chord";

export function ChordIndicator() {
  const { t } = useTranslation();
  const [prefix, setPrefix] = useState<string | null>(null);

  useEffect(() => onChordPrefix(setPrefix), []);

  if (!prefix) return null;
  return (
    <output
      className="flex items-center space-x-1 rounded border border-surface-border bg-surface-bg-subtle px-2 py-0.5 text-xs"
      aria-live="polite"
    >
      <kbd className="font-mono">({formatBinding(prefix)})</kbd>
      <span className="text-surface-fg-muted">
        {t("keybindings.chord.waiting", "waiting for next key…")}
      </span>
    </output>
  );
}
