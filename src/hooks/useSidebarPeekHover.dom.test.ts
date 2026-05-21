import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useLayout } from "../store/layout";
import { useSidebarPeek } from "../store/sidebar-peek";
import { useWorkspace } from "../store/workspace";
import { useSidebarPeekHover } from "./useSidebarPeekHover";

function buildDom() {
  const rail = document.createElement("div");
  rail.setAttribute("data-sidebar-rail", "");
  const peek = document.createElement("div");
  peek.setAttribute("data-sidebar-peek", "");
  document.body.append(rail, peek);
  return { rail, peek };
}

describe("useSidebarPeekHover", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    document.body.innerHTML = "";
    useWorkspace.setState({ current: "/ws" });
    useLayout.setState({ sidebarHidden: { "/ws": true } });
    useSidebarPeek.setState({ open: false, pinned: false, restoreFocusEl: null });
  });
  afterEach(() => {
    vi.useRealTimers();
    useWorkspace.setState({ current: null });
  });

  it("is inert when no workspace is open", () => {
    useWorkspace.setState({ current: null });
    const { rail } = buildDom();
    renderHook(() => useSidebarPeekHover());
    act(() => {
      rail.dispatchEvent(new MouseEvent("pointerover", { bubbles: true }));
      vi.advanceTimersByTime(500);
    });
    expect(useSidebarPeek.getState().open).toBe(false);
  });

  it("is inert when the sidebar is not collapsed", () => {
    useLayout.setState({ sidebarHidden: { "/ws": false } });
    const { rail } = buildDom();
    renderHook(() => useSidebarPeekHover());
    act(() => {
      rail.dispatchEvent(new MouseEvent("pointerover", { bubbles: true }));
      vi.advanceTimersByTime(500);
    });
    expect(useSidebarPeek.getState().open).toBe(false);
  });

  it("opens the peek after the enter debounce on rail hover", () => {
    const { rail } = buildDom();
    renderHook(() => useSidebarPeekHover());
    act(() => {
      rail.dispatchEvent(new MouseEvent("pointerover", { bubbles: true }));
    });
    expect(useSidebarPeek.getState().open).toBe(false);
    act(() => {
      vi.advanceTimersByTime(160);
    });
    expect(useSidebarPeek.getState().open).toBe(true);
  });

  it("cancels the open arm if the pointer leaves before the debounce", () => {
    const { rail } = buildDom();
    renderHook(() => useSidebarPeekHover());
    act(() => {
      rail.dispatchEvent(new MouseEvent("pointerover", { bubbles: true }));
      rail.dispatchEvent(new MouseEvent("pointerout", { bubbles: true }));
      vi.advanceTimersByTime(200);
    });
    expect(useSidebarPeek.getState().open).toBe(false);
  });

  it("closes the peek after the leave debounce", () => {
    const { rail, peek } = buildDom();
    renderHook(() => useSidebarPeekHover());
    act(() => {
      rail.dispatchEvent(new MouseEvent("pointerover", { bubbles: true }));
      vi.advanceTimersByTime(160);
    });
    expect(useSidebarPeek.getState().open).toBe(true);
    act(() => {
      peek.dispatchEvent(new MouseEvent("pointerout", { bubbles: true }));
      vi.advanceTimersByTime(250);
    });
    expect(useSidebarPeek.getState().open).toBe(false);
  });

  it("cancels a pending close when the pointer re-enters the peek surface", () => {
    const { rail, peek } = buildDom();
    renderHook(() => useSidebarPeekHover());
    act(() => {
      rail.dispatchEvent(new MouseEvent("pointerover", { bubbles: true }));
      vi.advanceTimersByTime(160);
    });
    expect(useSidebarPeek.getState().open).toBe(true);
    act(() => {
      // arm close
      rail.dispatchEvent(new MouseEvent("pointerout", { bubbles: true }));
    });
    act(() => {
      // re-enter peek → cancelClose clears leaveTimer
      peek.dispatchEvent(new MouseEvent("pointerover", { bubbles: true }));
      vi.advanceTimersByTime(500);
    });
    expect(useSidebarPeek.getState().open).toBe(true);
  });

  it("ignores pointer movement between the rail and peek surfaces", () => {
    const { rail, peek } = buildDom();
    renderHook(() => useSidebarPeekHover());
    act(() => {
      rail.dispatchEvent(new MouseEvent("pointerover", { bubbles: true }));
      vi.advanceTimersByTime(160);
    });
    // pointer leaves rail with relatedTarget=peek → no close arming
    const evRailToPeek = new MouseEvent("pointerout", { bubbles: true });
    Object.defineProperty(evRailToPeek, "relatedTarget", { value: peek });
    act(() => {
      rail.dispatchEvent(evRailToPeek);
      vi.advanceTimersByTime(500);
    });
    expect(useSidebarPeek.getState().open).toBe(true);
    // pointer leaves peek with relatedTarget=rail → still no close arming
    const evPeekToRail = new MouseEvent("pointerout", { bubbles: true });
    Object.defineProperty(evPeekToRail, "relatedTarget", { value: rail });
    act(() => {
      peek.dispatchEvent(evPeekToRail);
      vi.advanceTimersByTime(500);
    });
    expect(useSidebarPeek.getState().open).toBe(true);
  });

  it("clears a pending enter-arm when the pointer leaves before the peek opens", () => {
    const { rail } = buildDom();
    renderHook(() => useSidebarPeekHover());
    act(() => {
      rail.dispatchEvent(new MouseEvent("pointerover", { bubbles: true }));
      // pointerout while peek is not yet open → clearEnter branch
      rail.dispatchEvent(new MouseEvent("pointerout", { bubbles: true }));
      vi.advanceTimersByTime(500);
    });
    expect(useSidebarPeek.getState().open).toBe(false);
  });

  it("releases pending close timers when the controller unmounts", () => {
    const { rail } = buildDom();
    const { unmount } = renderHook(() => useSidebarPeekHover());
    act(() => {
      rail.dispatchEvent(new MouseEvent("pointerover", { bubbles: true }));
      vi.advanceTimersByTime(160);
      rail.dispatchEvent(new MouseEvent("pointerout", { bubbles: true }));
    });
    // unmount before the leave timer fires; cleanup should clear it
    unmount();
    act(() => {
      vi.advanceTimersByTime(500);
    });
    // hide() was never invoked because the timer was cleared on unmount
    expect(useSidebarPeek.getState().open).toBe(true);
  });

  it("short-circuits a second rail-enter while the peek is already open", () => {
    const { rail } = buildDom();
    renderHook(() => useSidebarPeekHover());
    act(() => {
      rail.dispatchEvent(new MouseEvent("pointerover", { bubbles: true }));
      vi.advanceTimersByTime(160);
    });
    expect(useSidebarPeek.getState().open).toBe(true);
    // second rail hover while open should hit the armOpen early-return guard
    act(() => {
      rail.dispatchEvent(new MouseEvent("pointerover", { bubbles: true }));
      vi.advanceTimersByTime(500);
    });
    expect(useSidebarPeek.getState().open).toBe(true);
  });

  it("ignores pointer activity outside the rail and peek surfaces", () => {
    buildDom();
    const outside = document.createElement("div");
    document.body.append(outside);
    renderHook(() => useSidebarPeekHover());
    act(() => {
      outside.dispatchEvent(new MouseEvent("pointerover", { bubbles: true }));
      outside.dispatchEvent(new MouseEvent("pointerout", { bubbles: true }));
      vi.advanceTimersByTime(500);
    });
    expect(useSidebarPeek.getState().open).toBe(false);
  });

  it("keeps the peek open when pinned", () => {
    const { rail, peek } = buildDom();
    renderHook(() => useSidebarPeekHover());
    act(() => {
      rail.dispatchEvent(new MouseEvent("pointerover", { bubbles: true }));
      vi.advanceTimersByTime(160);
    });
    useSidebarPeek.setState({ pinned: true });
    act(() => {
      peek.dispatchEvent(new MouseEvent("pointerout", { bubbles: true }));
      vi.advanceTimersByTime(250);
    });
    expect(useSidebarPeek.getState().open).toBe(true);
  });
});
