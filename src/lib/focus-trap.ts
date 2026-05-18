import { useEffect, useRef } from "react";

// S-A11-003: focus trap for modal surfaces (settings panel, command palette,
// confirmation dialogs).
//
// While the modal is open we:
//   1. Move focus to the first focusable child (or the container itself if
//      none are present yet — e.g. a dialog opened before async content).
//   2. Cycle Tab / Shift+Tab inside the container so screen-reader and
//      keyboard-only users never escape into the dimmed background layer.
//   3. Restore focus to whichever element opened the modal once it closes,
//      so the user lands back at their starting point instead of `<body>`.
//   4. Forward Esc to the caller so closing UX stays uniform across modals.

const FOCUSABLE_SELECTOR = [
  "a[href]",
  "area[href]",
  "button:not([disabled])",
  "input:not([disabled]):not([type='hidden'])",
  "select:not([disabled])",
  "textarea:not([disabled])",
  "[tabindex]:not([tabindex='-1'])",
  "[contenteditable='true']",
].join(",");

function focusable(container: HTMLElement): HTMLElement[] {
  return Array.from(container.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR)).filter(
    (el) => !el.hasAttribute("inert") && el.offsetParent !== null,
  );
}

export interface FocusTrapOptions {
  active: boolean;
  onEscape?: () => void;
}

export function useFocusTrap<T extends HTMLElement>(opts: FocusTrapOptions) {
  const containerRef = useRef<T | null>(null);

  useEffect(() => {
    if (!opts.active) return;
    const container = containerRef.current;
    if (!container) return;

    const previouslyFocused = document.activeElement as HTMLElement | null;
    const items = focusable(container);
    const initial = items[0] ?? container;
    if (initial === container && container.tabIndex < 0) {
      // Make the container itself focusable as a last resort so the trap has
      // something to anchor to. We use -1 so it doesn't pollute the tab ring
      // when other focusable children later mount.
      container.tabIndex = -1;
    }
    initial.focus();

    function onKeyDown(e: KeyboardEvent) {
      if (!container) return;
      if (e.key === "Escape") {
        e.stopPropagation();
        opts.onEscape?.();
        return;
      }
      if (e.key !== "Tab") return;
      const list = focusable(container);
      if (list.length === 0) {
        e.preventDefault();
        container.focus();
        return;
      }
      const first = list[0];
      const last = list[list.length - 1];
      if (!first || !last) return;
      const active = document.activeElement as HTMLElement | null;
      if (e.shiftKey) {
        if (active === first || !container.contains(active)) {
          e.preventDefault();
          last.focus();
        }
      } else {
        if (active === last || !container.contains(active)) {
          e.preventDefault();
          first.focus();
        }
      }
    }

    document.addEventListener("keydown", onKeyDown, true);
    return () => {
      document.removeEventListener("keydown", onKeyDown, true);
      // Some screens unmount the trigger itself (e.g. command palette opened
      // from a transient toast). Guard against `previouslyFocused` being
      // detached from the document before we restore focus.
      if (previouslyFocused && document.body.contains(previouslyFocused)) {
        previouslyFocused.focus();
      }
    };
  }, [opts.active, opts.onEscape]);

  return containerRef;
}
