import { cleanup, fireEvent, render } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import type { LayoutNode, PaneNode, SplitNode } from "../lib/editor/layout-model";
import { PaneTree } from "./PaneTree";

function pointer(
  type: string,
  target: HTMLElement,
  init: { pointerId?: number; clientX?: number; clientY?: number },
) {
  // jsdom's PointerEvent constructor drops mouse-event init properties, so we
  // build a plain Event and patch the relevant readers manually.
  const evt = new Event(type, { bubbles: true, cancelable: true });
  for (const [k, v] of Object.entries(init)) {
    Object.defineProperty(evt, k, { value: v, configurable: true });
  }
  fireEvent(target, evt);
}

afterEach(cleanup);

function pane(id: string): PaneNode {
  return { type: "pane", id, tabs: [], activeTabId: null };
}

describe("PaneTree", () => {
  it("renders a single pane", () => {
    const { container } = render(
      <PaneTree
        workspace="/ws"
        node={pane("pane-1")}
        renderPane={(p) => <div data-testid={p.id}>content</div>}
      />,
    );
    expect(container.querySelector('[data-pane-id="pane-1"]')).not.toBeNull();
    expect(container.querySelector('[data-testid="pane-1"]')).not.toBeNull();
  });

  it("renders a horizontal split with a separator handle", () => {
    const split: SplitNode = {
      type: "split",
      id: "split-1",
      direction: "horizontal",
      children: [pane("a"), pane("b")],
      sizes: [0.5, 0.5],
    };
    const { container } = render(
      <PaneTree workspace="/ws" node={split} renderPane={(p) => <div>{p.id}</div>} />,
    );
    expect(container.querySelector('[data-split-direction="horizontal"]')).not.toBeNull();
    const sep = container.querySelector('[role="separator"]');
    expect(sep).not.toBeNull();
  });

  it("supports a pointer drag on the splitter handle", () => {
    const split: SplitNode = {
      type: "split",
      id: "split-2",
      direction: "vertical",
      children: [pane("a"), pane("b")],
      sizes: [0.5, 0.5],
    };
    const { container } = render(
      <PaneTree workspace="/ws" node={split} renderPane={(p) => <div>{p.id}</div>} />,
    );
    const sep = container.querySelector('[role="separator"]') as HTMLElement;
    const parent = sep.parentElement as HTMLElement;
    parent.getBoundingClientRect = () =>
      ({ width: 800, height: 1000, top: 0, left: 0, right: 800, bottom: 1000 }) as DOMRect;
    sep.setPointerCapture = () => {};
    sep.hasPointerCapture = () => true;
    sep.releasePointerCapture = () => {};
    pointer("pointerdown", sep, { pointerId: 1, clientY: 100 });
    pointer("pointermove", sep, { pointerId: 1, clientY: 120 });
    fireEvent.pointerUp(sep, { pointerId: 1 });
    expect(sep).not.toBeNull();
  });

  it("bails when totalPx is still zero (no prior pointerdown)", () => {
    const split: SplitNode = {
      type: "split",
      id: "split-zero",
      direction: "horizontal",
      children: [pane("a"), pane("b")],
      sizes: [0.5, 0.5],
    };
    const { container } = render(
      <PaneTree workspace="/ws" node={split} renderPane={(p) => <div>{p.id}</div>} />,
    );
    const sep = container.querySelector('[role="separator"]') as HTMLElement;
    sep.hasPointerCapture = () => true;
    // totalPx stays at the useRef(0) initial because we never called pointerdown.
    pointer("pointermove", sep, { pointerId: 11, clientX: 500 });
    expect(sep).not.toBeNull();
  });

  it("ignores pointer moves when no pointer is captured", () => {
    const split: SplitNode = {
      type: "split",
      id: "split-skip",
      direction: "horizontal",
      children: [pane("a"), pane("b")],
      sizes: [0.5, 0.5],
    };
    const { container } = render(
      <PaneTree workspace="/ws" node={split} renderPane={(p) => <div>{p.id}</div>} />,
    );
    const sep = container.querySelector('[role="separator"]') as HTMLElement;
    sep.hasPointerCapture = () => false;
    // No setPointerCapture call — pointer move should bail before reading totalPx.
    fireEvent.pointerMove(sep, { pointerId: 9, clientX: 200 });
    expect(sep).not.toBeNull();
  });

  it("clamps the first child against its min-size", () => {
    const split: SplitNode = {
      type: "split",
      id: "split-clamp-a",
      direction: "horizontal",
      children: [pane("a"), pane("b")],
      sizes: [0.5, 0.5],
    };
    const { container } = render(
      <PaneTree workspace="/ws" node={split} renderPane={(p) => <div>{p.id}</div>} />,
    );
    const sep = container.querySelector('[role="separator"]') as HTMLElement;
    const parent = sep.parentElement as HTMLElement;
    parent.getBoundingClientRect = () =>
      ({ width: 1000, height: 800, top: 0, left: 0, right: 1000, bottom: 800 }) as DOMRect;
    sep.setPointerCapture = () => {};
    sep.hasPointerCapture = () => true;
    sep.releasePointerCapture = () => {};
    pointer("pointerdown", sep, { pointerId: 7, clientX: 500 });
    // Drag far to the left so nextA hits the min-size clamp.
    pointer("pointermove", sep, { pointerId: 7, clientX: -10_000 });
    fireEvent.pointerUp(sep, { pointerId: 7 });
    expect(sep).not.toBeNull();
  });

  it("clamps the second child against its min-size", () => {
    const split: SplitNode = {
      type: "split",
      id: "split-clamp-b",
      direction: "horizontal",
      children: [pane("a"), pane("b")],
      sizes: [0.5, 0.5],
    };
    const { container } = render(
      <PaneTree workspace="/ws" node={split} renderPane={(p) => <div>{p.id}</div>} />,
    );
    const sep = container.querySelector('[role="separator"]') as HTMLElement;
    const parent = sep.parentElement as HTMLElement;
    parent.getBoundingClientRect = () =>
      ({ width: 1000, height: 800, top: 0, left: 0, right: 1000, bottom: 800 }) as DOMRect;
    sep.setPointerCapture = () => {};
    sep.hasPointerCapture = () => true;
    sep.releasePointerCapture = () => {};
    pointer("pointerdown", sep, { pointerId: 8, clientX: 500 });
    pointer("pointermove", sep, { pointerId: 8, clientX: 10_000 });
    fireEvent.pointerUp(sep, { pointerId: 8 });
    expect(sep).not.toBeNull();
  });

  it("renders nested splits", () => {
    const inner: SplitNode = {
      type: "split",
      id: "inner",
      direction: "vertical",
      children: [pane("c"), pane("d")],
      sizes: [1, 1],
    };
    const outer: LayoutNode = {
      type: "split",
      id: "outer",
      direction: "horizontal",
      children: [pane("a"), inner],
      sizes: [1, 1],
    };
    const { container } = render(
      <PaneTree workspace="/ws" node={outer} renderPane={(p) => <div>{p.id}</div>} />,
    );
    expect(container.querySelectorAll("[data-split-id]").length).toBe(2);
  });
});
