// S-SBP-005: hover controller for the sidebar peek.
//
// Listens on the slim rail (`[data-sidebar-rail]`, F1 S-SBC-003) and
// the peek dialog (`[data-sidebar-peek]`). Implements the ADR-0002 D2
// debounce schedule: 150 ms enter, 200 ms leave.
//
// State machine:
//
//   IDLE ──pointerenter(rail)──▶ ARMED ──150ms──▶ OPEN
//     ▲                          │
//     │                       pointerleave(rail)
//     │                          │
//     └──────────────────────────┘   (cancels timer)
//
//   OPEN ──pointerleave(rail+peek)──▶ CLOSING ──200ms──▶ IDLE
//                                       │
//                                    pointerenter(rail|peek)
//                                       │
//                                       └──cancel▶ OPEN
//
// Pinned peek (ADR-0002 D4) freezes the close timer; only an explicit
// hide() call dismisses. Sidebar already expanded (ADR-0002 D1) blocks
// the open arming entirely — there's nothing to peek at.
//
// The two surfaces aren't always mounted (peek is conditional on `open`,
// rail is conditional on F1 collapsed-in-rail mode), so we re-attach on
// every render. The listener bookkeeping is cheap; the alternative is
// MutationObserver, which is heavier than the React parent re-rendering.

import { useEffect } from "react";
import { useLayout } from "../store/layout";
import { useSidebarPeek } from "../store/sidebar-peek";
import { useWorkspace } from "../store/workspace";

const ENTER_MS = 150;
const LEAVE_MS = 200;

export function useSidebarPeekHover(): void {
  const workspace = useWorkspace((s) => s.current);
  const sidebarHidden = useLayout((s) =>
    workspace ? s.isSidebarHidden(workspace) : false,
  );
  const peekOpen = useSidebarPeek((s) => s.open);
  const pinned = useSidebarPeek((s) => s.pinned);
  const show = useSidebarPeek((s) => s.show);
  const hide = useSidebarPeek((s) => s.hide);

  useEffect(() => {
    // Peek hover is only meaningful when (a) a workspace is open and
    // (b) the sidebar is currently collapsed. The rail is the only
    // hover target and it only exists in that combined state.
    if (!workspace || !sidebarHidden) return;

    let enterTimer: number | null = null;
    let leaveTimer: number | null = null;
    let lastFocus: HTMLElement | null = null;

    const clearEnter = () => {
      if (enterTimer != null) {
        window.clearTimeout(enterTimer);
        enterTimer = null;
      }
    };
    const clearLeave = () => {
      if (leaveTimer != null) {
        window.clearTimeout(leaveTimer);
        leaveTimer = null;
      }
    };

    const armOpen = () => {
      if (useSidebarPeek.getState().open) return;
      clearLeave();
      clearEnter();
      lastFocus = document.activeElement as HTMLElement | null;
      enterTimer = window.setTimeout(() => {
        enterTimer = null;
        // Re-check at fire-time — fast pointer-out before the timer
        // could have flipped intent already.
        if (!useSidebarPeek.getState().open) {
          show(lastFocus);
        }
      }, ENTER_MS);
    };

    const armClose = () => {
      if (useSidebarPeek.getState().pinned) return;
      if (!useSidebarPeek.getState().open) {
        clearEnter();
        return;
      }
      clearLeave();
      leaveTimer = window.setTimeout(() => {
        leaveTimer = null;
        if (!useSidebarPeek.getState().pinned) hide();
      }, LEAVE_MS);
    };

    const cancelClose = () => {
      clearLeave();
    };

    const onPointerOver = (e: PointerEvent) => {
      const target = e.target;
      if (!(target instanceof Element)) return;
      if (target.closest("[data-sidebar-rail]")) {
        armOpen();
        cancelClose();
      } else if (target.closest("[data-sidebar-peek]")) {
        cancelClose();
      }
    };

    const onPointerOut = (e: PointerEvent) => {
      const target = e.target;
      const related = e.relatedTarget;
      if (!(target instanceof Element)) return;
      const fromRail = !!target.closest("[data-sidebar-rail]");
      const fromPeek = !!target.closest("[data-sidebar-peek]");
      if (!fromRail && !fromPeek) return;
      // If the pointer moved into the *other* surface (rail↔peek), keep
      // the peek open. Only arm close when leaving both.
      if (related instanceof Element) {
        if (related.closest("[data-sidebar-rail]")) return;
        if (related.closest("[data-sidebar-peek]")) return;
      }
      if (useSidebarPeek.getState().open) {
        armClose();
      } else {
        clearEnter();
      }
    };

    document.addEventListener("pointerover", onPointerOver);
    document.addEventListener("pointerout", onPointerOut);
    return () => {
      document.removeEventListener("pointerover", onPointerOver);
      document.removeEventListener("pointerout", onPointerOut);
      clearEnter();
      clearLeave();
    };
  }, [workspace, sidebarHidden, peekOpen, pinned, show, hide]);
}
