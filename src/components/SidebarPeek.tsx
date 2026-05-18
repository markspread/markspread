// S-SBP-002: floating overlay shell for the sidebar peek.
//
// The overlay is anchored to the slim rail's left edge (F1, S-SBC-003),
// occupies a fixed 320px column, and sits at z-index `--z-peek` so the
// command palette (60) and Settings sheet (50) win when both are open.
//
// Content (FileTree) lands in S-SBP-003; this component owns the shell:
//   - positioning + size (ADR-0002 D2/D5)
//   - mount/unmount + focus restore (ADR-0002 D7)
//   - Esc to close, click-outside auto-close (ADR-0002 D3)
//
// The store (`useSidebarPeek`) is the source of truth — anyone calling
// `show()` opens it. Triggers (rail hover, keybinding, palette command)
// live in S-SBP-005 and don't import this file.

import { useEffect, useRef } from "react";
import { useTranslation } from "react-i18next";
import { useSidebarPeek } from "../store/sidebar-peek";
import { useWorkspace } from "../store/workspace";
import { FileTree } from "./FileTree";
import { Icon } from "./Icon";

const PEEK_WIDTH_PX = 320;

export function SidebarPeek() {
  const { t } = useTranslation();
  const open = useSidebarPeek((s) => s.open);
  const pinned = useSidebarPeek((s) => s.pinned);
  const hide = useSidebarPeek((s) => s.hide);
  const togglePinned = useSidebarPeek((s) => s.togglePinned);
  // S-SBP-003: peek renders the same FileTree that the persistent
  // sidebar mounts. Expansion / selection state is workspace-scoped in
  // `useFileTree`, so the two surfaces share folder-open status by
  // design — VSCode parity. No separate "peek scope" today; if users
  // start asking for independent state we'd add a `stateKey` prop on
  // FileTree, not a second store. The peek is a *view* of the tree.
  const workspace = useWorkspace((s) => s.current);
  const dialogRef = useRef<HTMLDivElement | null>(null);

  // Esc → close. Pin state does NOT block this — Esc is the user's
  // explicit "go away" signal (ADR-0002 D3 §4).
  // Mod+Shift+B → pin toggle (ADR-0002 D4). We handle the shortcut
  // here instead of through the global keybinding registry because the
  // command is only meaningful while peek is mounted — adding a
  // `when: "peekOpen"` clause to the registry would force a context
  // probe on every keystroke that isn't paying its way yet.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        hide();
        return;
      }
      const mod = e.metaKey || e.ctrlKey;
      if (mod && e.shiftKey && e.key.toLowerCase() === "b") {
        e.preventDefault();
        togglePinned();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, hide, togglePinned]);

  // Click-outside auto-close. Pinned peeks ignore this — D3 lists pin
  // as the exception. We listen on the document and skip clicks inside
  // the dialog or on the rail (the rail click is a separate F1 action
  // that toggles the persisted sidebar; peek shouldn't intercept).
  useEffect(() => {
    if (!open || pinned) return;
    const onPointerDown = (e: PointerEvent) => {
      const target = e.target;
      if (!(target instanceof Node)) return;
      if (dialogRef.current?.contains(target)) return;
      if (target instanceof Element && target.closest("[data-sidebar-rail]")) return;
      hide();
    };
    document.addEventListener("pointerdown", onPointerDown, true);
    return () => document.removeEventListener("pointerdown", onPointerDown, true);
  }, [open, pinned, hide]);

  // S-SBP-006: focus-out auto-close. When focus moves to any element
  // that isn't inside the peek (or on the rail trigger), close. Tab key
  // cycles naturally inside the peek because we never trap focus —
  // there's just a guard so leaving via Tab doesn't strand the user in
  // a dialog they can't reach again.
  useEffect(() => {
    if (!open || pinned) return;
    const onFocusIn = (e: FocusEvent) => {
      const target = e.target;
      if (!(target instanceof Element)) return;
      if (dialogRef.current?.contains(target)) return;
      if (target.closest("[data-sidebar-rail]")) return;
      hide();
    };
    document.addEventListener("focusin", onFocusIn);
    return () => document.removeEventListener("focusin", onFocusIn);
  }, [open, pinned, hide]);

  // S-SBP-009: pull initial focus into the tree so a keyboard-invoked
  // peek lands on the first row, ready for arrow-key nav. We wait one
  // microtask for the tree to finish its own mount-time focus dance
  // before claiming the focus ourselves. Fallback to the dialog
  // wrapper if the tree isn't there yet (e.g., empty workspace).
  useEffect(() => {
    if (!open) return;
    const id = window.setTimeout(() => {
      const tree = dialogRef.current?.querySelector<HTMLElement>(
        '[role="tree"][data-filetree-root="true"]',
      );
      (tree ?? dialogRef.current)?.focus();
    }, 0);
    return () => window.clearTimeout(id);
  }, [open]);

  if (!open) return null;

  return (
    <div
      ref={dialogRef}
      // biome-ignore lint/a11y/useSemanticElements: dialog overlay keeps div for layout/portal control
      role="dialog"
      aria-modal="false"
      aria-label={t("peek.aria.dialog", "File tree (peek)")}
      tabIndex={-1}
      data-sidebar-peek
      style={{
        position: "fixed",
        top: 56,
        left: 0,
        width: PEEK_WIDTH_PX,
        maxHeight: "calc(100vh - 96px)",
        zIndex: "var(--z-peek)",
      }}
      className="flex min-h-0 flex-col overflow-hidden rounded-r-md border border-[var(--color-border)] bg-[var(--color-surface)] text-sm shadow-lg motion-safe:animate-[peek-in_140ms_ease-out]"
    >
      <header className="flex items-center justify-between border-[var(--color-border)] border-b bg-[var(--color-surface-subtle)] px-3 py-1.5">
        <span className="font-medium text-xs">{t("peek.title", "Files")}</span>
        <button
          type="button"
          onClick={togglePinned}
          className="text-[var(--color-muted)] text-xs hover:text-[var(--color-fg)]"
          aria-pressed={pinned}
          aria-label={
            pinned ? t("peek.action.unpin", "Unpin peek") : t("peek.action.pin", "Pin peek")
          }
          title={
            pinned
              ? t("peek.action.unpin.tooltip", "Unpin (⌘⇧B)")
              : t("peek.action.pin.tooltip", "Pin (⌘⇧B)")
          }
        >
          <Icon name={pinned ? "pin" : "pin-off"} size={14} />
        </button>
      </header>
      {/* S-SBP-004: independent scroll area. FileTree already owns its
          own `flex-1 overflow-auto` container and switches to a
          windowed renderer past 500 nodes, so nesting it inside this
          `min-h-0 flex-1` slot inherits 60fps virtualization "for
          free". Scroll-position restore on re-open is deferred —
          ADR-0002 D4 keeps peek state strictly session-scoped, and a
          per-mount scroll memo would contradict that without a clear
          user request. */}
      <div className="flex min-h-0 flex-1 flex-col">
        {workspace && <FileTree workspace={workspace} />}
      </div>
    </div>
  );
}
