// S-SBP-002: ephemeral peek-overlay state. Session-scoped (ADR-0002 D4)
// so we don't persist anything — the user's pin choice is forgotten on
// reload, and that's intentional.
//
// `restoreFocusEl` lets the open() caller remember the DOM node that
// was focused at the moment peek appeared so close() can return focus
// there. It's a transient HTMLElement reference; never serialise.

import { create } from "zustand";

interface SidebarPeekState {
  open: boolean;
  pinned: boolean;
  restoreFocusEl: HTMLElement | null;
  show: (restoreFocusEl?: HTMLElement | null) => void;
  hide: () => void;
  togglePinned: () => void;
}

export const useSidebarPeek = create<SidebarPeekState>((set, get) => ({
  open: false,
  pinned: false,
  restoreFocusEl: null,
  show: (restoreFocusEl) => {
    if (get().open) return;
    set({ open: true, restoreFocusEl: restoreFocusEl ?? null });
  },
  hide: () => {
    if (!get().open) return;
    const target = get().restoreFocusEl;
    set({ open: false, pinned: false, restoreFocusEl: null });
    target?.focus();
  },
  togglePinned: () => set((s) => ({ pinned: !s.pinned })),
}));
