import { useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { ACTIONS, type ActionCategory, type ActionContext, rankActions } from "../lib/ai/actions";
import { useFocusTrap } from "../lib/focus-trap";

// S-AI-001: ⌘. action palette. Opens with the editor's current selection
// context so the relevant actions float to the top. Up/Down navigates,
// Enter triggers, Esc closes — and the focus trap keeps the keyboard
// inside the popup until the user dismisses it.

interface AiActionPaletteProps {
  open: boolean;
  context: ActionContext;
  onClose: () => void;
  onInvoke: (actionId: string) => void;
}

const CATEGORY_LABEL: Record<ActionCategory, string> = {
  edit: "ai.category.edit",
  generate: "ai.category.generate",
  translate: "ai.category.translate",
  summarize: "ai.category.summarize",
  custom: "ai.category.custom",
};

export function AiActionPalette({ open, context, onClose, onInvoke }: AiActionPaletteProps) {
  const { t } = useTranslation();
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const trapRef = useFocusTrap<HTMLDivElement>({ active: open, onEscape: onClose });

  const items = useMemo(() => {
    const ranked = rankActions(ACTIONS, context);
    if (!query) return ranked;
    const q = query.toLowerCase();
    return ranked.filter((a) => a.id.toLowerCase().includes(q) || a.labelKey.toLowerCase().includes(q));
  }, [context, query]);

  useEffect(() => {
    if (open) inputRef.current?.focus();
  }, [open]);

  useEffect(() => {
    setActive(0);
  }, [query, open]);

  if (!open) return null;

  function handleKey(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setActive((i) => Math.min(i + 1, items.length - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActive((i) => Math.max(i - 1, 0));
    } else if (e.key === "Enter") {
      e.preventDefault();
      const selected = items[active];
      if (selected) {
        onInvoke(selected.id);
        onClose();
      }
    }
  }

  // Group items by category for visual separators while preserving the
  // ranked order — categories appear in the order they first show up.
  const grouped: { category: ActionCategory; items: typeof items }[] = [];
  for (const item of items) {
    const last = grouped[grouped.length - 1];
    if (last && last.category === item.category) {
      last.items.push(item);
    } else {
      grouped.push({ category: item.category, items: [item] });
    }
  }

  let runningIndex = -1;

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center bg-black/30 pt-24"
      role="dialog"
      aria-modal="true"
      aria-label={t("ai.palette.aria", "AI action palette")}
      onClick={onClose}
    >
      <div
        ref={trapRef}
        className="w-full max-w-lg rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <input
          ref={inputRef}
          type="text"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={handleKey}
          placeholder={t("ai.palette.placeholder", "Search AI actions…")}
          className="w-full border-[var(--color-border)] border-b bg-transparent px-4 py-3 text-sm focus:outline-none"
          aria-label={t("ai.palette.search.aria", "Search AI actions")}
        />
        <ul
          role="listbox"
          aria-label={t("ai.palette.list.aria", "AI actions")}
          className="max-h-80 overflow-auto py-1"
        >
          {grouped.map((group) => (
            <li key={group.category} className="py-1">
              <div className="px-4 py-1 font-semibold text-[var(--color-muted)] text-xs uppercase tracking-wider">
                {t(CATEGORY_LABEL[group.category], group.category)}
              </div>
              {group.items.map((item) => {
                runningIndex += 1;
                const idx = runningIndex;
                const selected = idx === active;
                return (
                  <button
                    key={item.id}
                    type="button"
                    role="option"
                    aria-selected={selected}
                    className={`flex w-full items-center justify-between px-4 py-2 text-left text-sm ${
                      selected ? "bg-[var(--color-accent)]/15" : "hover:bg-[var(--color-border)]/30"
                    }`}
                    onMouseEnter={() => setActive(idx)}
                    onClick={() => {
                      onInvoke(item.id);
                      onClose();
                    }}
                  >
                    <span>{t(item.labelKey, item.labelKey)}</span>
                    {item.hint && (
                      <kbd className="text-[var(--color-muted)] text-xs">{item.hint}</kbd>
                    )}
                  </button>
                );
              })}
            </li>
          ))}
          {items.length === 0 && (
            <li className="px-4 py-6 text-center text-[var(--color-muted)] text-sm">
              {t("ai.palette.empty", "No matching actions")}
            </li>
          )}
        </ul>
      </div>
    </div>
  );
}
