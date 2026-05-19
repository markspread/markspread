import { cleanup, fireEvent, render } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import type { LayoutNode, PaneNode, SplitNode } from "../lib/editor/layout-model";
import { PaneTree } from "./PaneTree";

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
    sep.setPointerCapture = () => {};
    sep.hasPointerCapture = () => true;
    sep.releasePointerCapture = () => {};
    fireEvent.pointerDown(sep, { pointerId: 1, clientY: 100 });
    fireEvent.pointerMove(sep, { pointerId: 1, clientY: 120 });
    fireEvent.pointerUp(sep, { pointerId: 1 });
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
