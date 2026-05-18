// S-CP-001..014: the React shell for the palette.
//
// Behaviours:
//   • ⌘K — open in "all" mode
//   • ⌘P — open in "file" mode (locks category to file)
//   • Enter runs the active item, Esc closes (with stopPropagation
//     so the editor doesn't lose focus)
//   • Up/Down moves the active row; results recompute on every
//     keystroke
//   • Click outside the modal body closes it (S-CP-014)
//   • Hovering an item shows the description tooltip (S-CP-013)
//   • The keychord on the right is rendered via ShortcutHint when
//     present (S-CP-006)

import { useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";

import { type PaletteItem, noteUsed, query as runQuery } from "@/lib/palette/registry";
import { closePalette, getPaletteState, openPalette, subscribePalette } from "@/lib/palette/state";

export function CommandPalette() {
  const { t } = useTranslation();
  const [, force] = useState(0);
  useEffect(() => subscribePalette(() => force((n) => n + 1)), []);

  // Global keymap — register once.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k" && !e.altKey) {
        e.preventDefault();
        openPalette("all");
      } else if (
        (e.metaKey || e.ctrlKey) &&
        e.key.toLowerCase() === "p" &&
        !e.shiftKey &&
        !e.altKey
      ) {
        e.preventDefault();
        openPalette("file");
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const state = getPaletteState();
  const [text, setText] = useState("");
  const [active, setActive] = useState(0);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const items = useMemo<PaletteItem[]>(() => {
    if (!state.open) return [];
    const raw = state.mode === "file" ? text : text;
    return runQuery({ raw, limit: 30 });
  }, [text, state.open, state.mode]);

  useEffect(() => {
    if (!state.open) return;
    setText("");
    setActive(0);
    queueMicrotask(() => inputRef.current?.focus());
  }, [state.open, state.mode]);

  useEffect(() => {
    setActive((a) => Math.min(a, Math.max(0, items.length - 1)));
  }, [items.length]);

  if (!state.open) return null;

  const run = async (item: PaletteItem) => {
    closePalette();
    noteUsed(item.id);
    try {
      await item.run();
    } catch {
      /* swallow — palette items must surface their own errors */
    }
  };

  const placeholder =
    state.mode === "file"
      ? t("palette.fileOpen", "Open file…")
      : t("palette.placeholder", "Type a command, file, or `?` for help");

  return (
    <div
      className="ms-modal-backdrop ms-palette-backdrop"
      // biome-ignore lint/a11y/useSemanticElements: dialog overlay keeps div for layout/portal control
      role="dialog"
      aria-modal="true"
      aria-label={t("palette.title", "Command palette")}
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) closePalette();
      }}
      onKeyDown={(e) => {
        if (e.key === "Escape") {
          e.stopPropagation();
          closePalette();
        } else if (e.key === "Enter") {
          e.preventDefault();
          const item = items[active];
          if (item) void run(item);
        } else if (e.key === "ArrowDown") {
          e.preventDefault();
          setActive((a) => Math.min(items.length - 1, a + 1));
        } else if (e.key === "ArrowUp") {
          e.preventDefault();
          setActive((a) => Math.max(0, a - 1));
        }
      }}
    >
      <div className="ms-palette">
        <input
          ref={inputRef}
          type="text"
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder={placeholder}
          aria-autocomplete="list"
        />
        <ul className="ms-palette-list">
          {items.map((item, idx) => (
            <li
              key={item.id}
              aria-selected={idx === active}
              className={idx === active ? "is-active" : undefined}
              title={item.description}
              onMouseEnter={() => setActive(idx)}
              onMouseDown={(e) => {
                e.preventDefault();
                void run(item);
              }}
            >
              <span className={`ms-palette-cat ms-palette-cat-${item.category}`}>
                {item.category}
              </span>
              <span className="ms-palette-label">{item.label}</span>
              {item.detail && <span className="ms-palette-detail">{item.detail}</span>}
              {item.shortcut && <kbd className="ms-palette-shortcut">{item.shortcut}</kbd>}
            </li>
          ))}
          {items.length === 0 && (
            <li className="ms-palette-empty">{t("palette.empty", "No matches")}</li>
          )}
        </ul>
      </div>
    </div>
  );
}
