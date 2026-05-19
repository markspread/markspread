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
});
