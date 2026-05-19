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
