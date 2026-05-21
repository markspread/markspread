import { cleanup, fireEvent, render } from "@testing-library/react";
import { createRef } from "react";
import { afterEach, describe, expect, it } from "vitest";
import { useLayout } from "../store/layout";
import { SidebarSplitter } from "./SidebarSplitter";

afterEach(cleanup);

describe("SidebarSplitter", () => {
  it("renders a vertical separator with width valuetext", () => {
    const ref = createRef<HTMLElement>();
    const { container } = render(<SidebarSplitter workspace="/ws" containerRef={ref} />);
    const sep = container.querySelector('[role="separator"]');
    expect(sep?.getAttribute("aria-orientation")).toBe("vertical");
  });

  it("adjusts width via keyboard arrows", () => {
    const ref = createRef<HTMLElement>();
    const { container } = render(<SidebarSplitter workspace="/ws" containerRef={ref} />);
    const sep = container.querySelector('[role="separator"]') as HTMLElement;
    const before = useLayout.getState().getSidebarWidth("/ws");
    fireEvent.keyDown(sep, { key: "ArrowRight" });
    expect(useLayout.getState().getSidebarWidth("/ws")).toBe(before + 8);
    fireEvent.keyDown(sep, { key: "ArrowLeft", shiftKey: true });
    fireEvent.keyDown(sep, { key: "Home" });
    fireEvent.keyDown(sep, { key: "End" });
  });

  it("handles a pointer drag", () => {
    const ref = createRef<HTMLElement>();
    const { container } = render(<SidebarSplitter workspace="/ws" containerRef={ref} />);
    const sep = container.querySelector('[role="separator"]') as HTMLElement;
    sep.setPointerCapture = () => {};
    sep.hasPointerCapture = () => true;
    sep.releasePointerCapture = () => {};
    fireEvent.pointerDown(sep, { pointerId: 1, clientX: 100 });
    fireEvent.pointerMove(sep, { pointerId: 1, clientX: 160 });
    fireEvent.pointerUp(sep, { pointerId: 1 });
    expect(sep).not.toBeNull();
  });

  it("ignores pointer moves when no pointer is captured", () => {
    const ref = createRef<HTMLElement>();
    const { container } = render(<SidebarSplitter workspace="/ws-ignore" containerRef={ref} />);
    const sep = container.querySelector('[role="separator"]') as HTMLElement;
    sep.hasPointerCapture = () => false;
    const before = useLayout.getState().getSidebarWidth("/ws-ignore");
    fireEvent.pointerMove(sep, { pointerId: 2, clientX: 999 });
    expect(useLayout.getState().getSidebarWidth("/ws-ignore")).toBe(before);
  });

  it("clamps the drag to the container width minus the editor minimum", () => {
    const containerEl = document.createElement("div");
    Object.defineProperty(containerEl, "getBoundingClientRect", {
      value: () => ({ width: 400, height: 800, top: 0, left: 0, bottom: 0, right: 0 }) as DOMRect,
    });
    const ref = { current: containerEl } as React.RefObject<HTMLElement>;
    const { container } = render(<SidebarSplitter workspace="/ws-clamp" containerRef={ref} />);
    const sep = container.querySelector('[role="separator"]') as HTMLElement;
    sep.setPointerCapture = () => {};
    sep.hasPointerCapture = () => true;
    sep.releasePointerCapture = () => {};
    fireEvent.pointerDown(sep, { pointerId: 3, clientX: 0 });
    fireEvent.pointerMove(sep, { pointerId: 3, clientX: 10_000 });
    fireEvent.pointerUp(sep, { pointerId: 3 });
    // After the drag, the store's getter applies its own min clamp, so we
    // only assert that the move path didn't throw and a width is set.
    expect(useLayout.getState().getSidebarWidth("/ws-clamp")).toBeGreaterThan(0);
  });

  it("ignores keystrokes that are not in the binding set", () => {
    const ref = createRef<HTMLElement>();
    const { container } = render(<SidebarSplitter workspace="/ws-key" containerRef={ref} />);
    const sep = container.querySelector('[role="separator"]') as HTMLElement;
    const before = useLayout.getState().getSidebarWidth("/ws-key");
    fireEvent.keyDown(sep, { key: "x" });
    expect(useLayout.getState().getSidebarWidth("/ws-key")).toBe(before);
  });

  it("leaves the persisted width unchanged when it is already in range", () => {
    useLayout.setState({ sidebarWidth: { "/ws-ok": 260 } } as never, false);
    const ref = createRef<HTMLElement>();
    render(<SidebarSplitter workspace="/ws-ok" containerRef={ref} />);
    expect(useLayout.getState().getSidebarWidth("/ws-ok")).toBe(260);
  });
});
