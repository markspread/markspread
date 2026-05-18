import { useEffect, useRef, useState } from "react";

export interface ContextMenuItem {
  id: string;
  label: string;
  shortcut?: string;
  disabled?: boolean;
  onSelect: () => void;
  separator?: false;
}

export interface ContextMenuSeparator {
  separator: true;
}

export type ContextMenuEntry = ContextMenuItem | ContextMenuSeparator;

interface ContextMenuProps {
  x: number;
  y: number;
  items: ContextMenuEntry[];
  onClose: () => void;
}

/**
 * S-FT-013: floating menu with keyboard navigation. ↑↓ moves focus through
 * non-separator items, Enter activates, Escape closes. Click outside also
 * closes. Position is clamped to viewport.
 */
export function ContextMenu({ x, y, items, onClose }: ContextMenuProps) {
  const ref = useRef<HTMLUListElement | null>(null);
  const [focusIdx, setFocusIdx] = useState<number>(() => firstSelectable(items));

  useEffect(() => {
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose();
    };
    window.addEventListener("mousedown", onDown);
    return () => window.removeEventListener("mousedown", onDown);
  }, [onClose]);

  // Focus the menu so it can receive keystrokes immediately.
  useEffect(() => {
    ref.current?.focus();
  }, []);

  // Clamp the menu position within the viewport so we don't render off-screen.
  const [pos, setPos] = useState({ left: x, top: y });
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    const left = Math.min(x, vw - r.width - 4);
    const top = Math.min(y, vh - r.height - 4);
    setPos({ left: Math.max(4, left), top: Math.max(4, top) });
  }, [x, y]);

  const move = (dir: 1 | -1) => {
    const next = nextSelectable(items, focusIdx, dir);
    if (next != null) setFocusIdx(next);
  };

  return (
    <ul
      ref={ref}
      role="menu"
      tabIndex={-1}
      style={{ left: pos.left, top: pos.top, minWidth: 200 }}
      className="fixed z-50 rounded-md border border-[var(--color-border)] bg-[var(--color-surface)] py-1 text-sm shadow-lg outline-none"
      onKeyDown={(e) => {
        if (e.key === "ArrowDown") {
          e.preventDefault();
          move(1);
        } else if (e.key === "ArrowUp") {
          e.preventDefault();
          move(-1);
        } else if (e.key === "Enter") {
          e.preventDefault();
          const it = items[focusIdx];
          if (it && !("separator" in it) && !it.disabled) {
            it.onSelect();
            onClose();
          }
        } else if (e.key === "Escape") {
          e.preventDefault();
          onClose();
        }
      }}
    >
      {items.map((it, idx) =>
        "separator" in it ? (
          // biome-ignore lint/suspicious/noArrayIndexKey: static separator with no stable id; menu list never reorders
          <li key={`sep-${idx}`} className="my-1 border-[var(--color-border)] border-t" />
        ) : (
          // biome-ignore lint/a11y/useKeyWithClickEvents: keyboard handled by parent <ul role="menu"> onKeyDown
          <li
            key={it.id}
            aria-disabled={it.disabled}
            className={`flex items-center justify-between px-3 py-1.5 ${
              it.disabled ? "cursor-not-allowed text-[var(--color-muted)]" : "cursor-pointer"
            } ${idx === focusIdx && !it.disabled ? "bg-[var(--color-border)]/40" : ""}`}
            onMouseEnter={() => setFocusIdx(idx)}
            onClick={() => {
              if (it.disabled) return;
              it.onSelect();
              onClose();
            }}
          >
            <span>{it.label}</span>
            {it.shortcut && (
              <span className="ml-4 text-[var(--color-muted)] text-xs">{it.shortcut}</span>
            )}
          </li>
        ),
      )}
    </ul>
  );
}

function firstSelectable(items: ContextMenuEntry[]): number {
  for (let i = 0; i < items.length; i += 1) {
    const it = items[i];
    if (it && !("separator" in it) && !it.disabled) return i;
  }
  return 0;
}

function nextSelectable(items: ContextMenuEntry[], from: number, dir: 1 | -1): number | null {
  let i = from + dir;
  while (i >= 0 && i < items.length) {
    const it = items[i];
    if (it && !("separator" in it) && !it.disabled) return i;
    i += dir;
  }
  return null;
}
