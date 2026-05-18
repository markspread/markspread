// S-KB-003: keybinding sheet, opened with the help.shortcuts command
// (⌘/ on macOS, Ctrl+/ elsewhere). The sheet lists every active
// binding grouped by command category, with a search box that
// matches against title and binding label.
//
// Layout-aware display: each binding step's key segment is
// re-labelled via labelForCode(codeFromKeySegment(...)) so AZERTY /
// Dvorak / 한글 users see the character actually printed on their
// physical key rather than the underlying QWERTY position.

import { useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";

import { commands } from "@/lib/commands/registry";
import {
  type BindingEntry,
  formatBinding,
  listActiveBindings,
} from "@/lib/keybindings";
import {
  codeFromKeySegment,
  labelForCode,
  loadLayoutMap,
  onLayoutChange,
} from "@/lib/keybindings/layout";

type Row = {
  commandId: string;
  title: string;
  category: string;
  binding: string;
  source: BindingEntry["source"] | "unbound";
};

type Props = {
  onClose: () => void;
  onEditBinding: (commandId: string) => void;
};

export function KeybindingSheet({ onClose, onEditBinding }: Props) {
  const { t } = useTranslation();
  const [query, setQuery] = useState("");
  const [, setLayoutVersion] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);

  // Pre-warm the layout map and re-render on layoutchange so the
  // displayed key labels track external layout switches.
  useEffect(() => {
    void loadLayoutMap().then(() => setLayoutVersion((v) => v + 1));
    return onLayoutChange(() => setLayoutVersion((v) => v + 1));
  }, []);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") {
        e.preventDefault();
        onClose();
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const rows: Row[] = useMemo(() => {
    const bindings = new Map<string, BindingEntry>();
    for (const e of listActiveBindings()) bindings.set(e.commandId, e);
    return commands.map((cmd) => {
      const e = bindings.get(cmd.id);
      return {
        commandId: cmd.id,
        title: cmd.title,
        category: cmd.category,
        binding: e ? layoutAwareDisplay(e.binding) : "",
        source: e ? e.source : "unbound",
      };
    });
  }, []);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return rows;
    return rows.filter((r) =>
      r.title.toLowerCase().includes(q) ||
      r.category.toLowerCase().includes(q) ||
      r.binding.toLowerCase().includes(q) ||
      r.commandId.toLowerCase().includes(q),
    );
  }, [rows, query]);

  const grouped = useMemo(() => {
    const m = new Map<string, Row[]>();
    for (const r of filtered) {
      const list = m.get(r.category) ?? [];
      list.push(r);
      m.set(r.category, list);
    }
    return [...m.entries()].sort((a, b) => a[0].localeCompare(b[0]));
  }, [filtered]);

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center bg-black/40 pt-24"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
      aria-labelledby="kb-sheet-title"
    >
      <div
        className="w-full max-w-2xl rounded-lg border border-surface-border bg-surface-bg shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <header className="flex items-center justify-between border-b border-surface-border p-4">
          <h2 id="kb-sheet-title" className="text-lg font-semibold">
            {t("keybindings.sheet.title", "Keyboard Shortcuts")}
          </h2>
          <button
            type="button"
            onClick={onClose}
            className="text-surface-fg-muted hover:text-surface-fg"
            aria-label={t("common.close", "Close")}
          >
            ×
          </button>
        </header>

        <div className="p-4">
          <input
            ref={inputRef}
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={t(
              "keybindings.sheet.search_placeholder",
              "Search shortcuts… (Esc to close)",
            )}
            className="w-full rounded-md border border-surface-border bg-surface-bg-subtle px-3 py-2 text-sm focus:border-brand-500 focus:outline-none"
            aria-label={t("keybindings.sheet.search_label", "Search shortcuts")}
          />
        </div>

        <div className="max-h-[50vh] overflow-y-auto px-4 pb-4">
          {grouped.length === 0 && (
            <p className="py-6 text-center text-sm text-surface-fg-muted">
              {t("keybindings.sheet.empty", "No shortcuts match your search.")}
            </p>
          )}
          {grouped.map(([category, items]) => (
            <section key={category} className="mb-4">
              <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-surface-fg-muted">
                {category}
              </h3>
              <ul className="divide-y divide-surface-border rounded-md border border-surface-border">
                {items.map((row) => (
                  <li
                    key={row.commandId}
                    className="flex items-center justify-between gap-3 px-3 py-2 text-sm hover:bg-surface-bg-subtle"
                  >
                    <Highlighted text={row.title} match={query} />
                    <div className="flex items-center gap-3">
                      {row.source === "unbound" ? (
                        <span className="text-xs text-surface-fg-muted">
                          {t("keybindings.sheet.unbound", "Unbound")}
                        </span>
                      ) : (
                        <kbd
                          className="rounded border border-surface-border bg-surface-bg-subtle px-2 py-0.5 font-mono text-xs"
                          data-source={row.source}
                        >
                          {row.binding}
                        </kbd>
                      )}
                      <button
                        type="button"
                        onClick={() => onEditBinding(row.commandId)}
                        className="text-xs text-brand-500 hover:underline"
                      >
                        {t("keybindings.sheet.edit", "Edit")}
                      </button>
                    </div>
                  </li>
                ))}
              </ul>
            </section>
          ))}
        </div>
      </div>
    </div>
  );
}

function Highlighted({ text, match }: { text: string; match: string }) {
  const q = match.trim();
  if (!q) return <span>{text}</span>;
  const idx = text.toLowerCase().indexOf(q.toLowerCase());
  if (idx === -1) return <span>{text}</span>;
  return (
    <span>
      {text.slice(0, idx)}
      <mark className="rounded bg-brand-500/20 px-0.5">
        {text.slice(idx, idx + q.length)}
      </mark>
      {text.slice(idx + q.length)}
    </span>
  );
}

/**
 * Render a stored binding (preset/user/plugin) using the user's
 * keyboard layout. We split each step on "+", relabel the key part
 * via labelForCode, then run through the same modifier-prettifier
 * formatBinding uses for everything else.
 */
function layoutAwareDisplay(binding: string): string {
  return binding
    .split(/\s+/)
    .map((step) => {
      const parts = step.split("+");
      const last = parts.at(-1) ?? "";
      const isMod = ["Mod", "Ctrl", "Alt", "Shift", "Meta"].includes(last);
      if (isMod) return formatBinding(step);
      const code = codeFromKeySegment(last);
      const relabeled = labelForCode(code);
      const rebuilt = [...parts.slice(0, -1), relabeled].join("+");
      return formatBinding(rebuilt);
    })
    .join(" ");
}
