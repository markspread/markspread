// S-MWS-004: 워크스페이스 셸 단축키 hook 의 jsdom 단위 테스트.

import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { useWorkspace } from "../store/workspace";
import {
  createTabsNode,
  createWorkspaceTab,
  emptyWindowLayout,
  forEachTabsNode,
  useWorkspaceLayout,
} from "../store/workspace-layout";
import {
  activeTabsNodeSize,
  computeLeafRects,
  focusSplitInDirection,
  pickNeighbourLeaf,
  useWorkspaceShellShortcuts,
} from "./useWorkspaceShellShortcuts";

function fire(
  key: string,
  opts: { meta?: boolean; ctrl?: boolean; shift?: boolean; alt?: boolean } = {},
): KeyboardEvent {
  const evt = new KeyboardEvent("keydown", {
    key,
    metaKey: !!opts.meta,
    ctrlKey: !!opts.ctrl,
    shiftKey: !!opts.shift,
    altKey: !!opts.alt,
    bubbles: true,
    cancelable: true,
  });
  act(() => {
    window.dispatchEvent(evt);
  });
  return evt;
}

function setPlatform(platform: string) {
  Object.defineProperty(navigator, "platform", {
    value: platform,
    configurable: true,
  });
}

// 테스트별로 mount/unmount 를 추적해 리스너가 누적되지 않도록 한다.
const mounted: Array<{ unmount: () => void }> = [];

function mount() {
  const h = renderHook(() => useWorkspaceShellShortcuts());
  mounted.push(h);
}

describe("useWorkspaceShellShortcuts", () => {
  beforeEach(() => {
    setPlatform("MacIntel");
    useWorkspaceLayout.setState({ layout: null });
    // ADR-0019: single Workspace shell — these shortcuts fire whenever a
    // workspace is open. Pin `current` so the matrix exercises bindings.
    useWorkspace.setState({ current: "/ws-a", readOnly: false });
  });

  afterEach(() => {
    while (mounted.length > 0) mounted.pop()?.unmount();
    useWorkspaceLayout.setState({ layout: null });
    useWorkspace.setState({ current: null, readOnly: false });
  });

  it("is a noop when no layout exists", () => {
    mount();
    fire("t", { meta: true });
    expect(useWorkspaceLayout.getState().layout).toBeNull();
  });

  it("Mod+T adds a new workspace tab cloned from the active path", () => {
    useWorkspaceLayout.setState({ layout: emptyWindowLayout("/ws-a") });
    mount();
    fire("t", { meta: true });
    expect(activeTabsNodeSize()).toBe(2);
  });

  it("Mod+T does nothing if active tab id is orphaned", () => {
    useWorkspaceLayout.setState({ layout: emptyWindowLayout("/ws-a") });
    const layout = useWorkspaceLayout.getState().layout;
    if (!layout) throw new Error("setup");
    useWorkspaceLayout.setState({ layout: { ...layout, activeTabId: "missing" } });
    mount();
    fire("t", { meta: true });
    expect(activeTabsNodeSize()).toBe(0);
  });

  it("Mod+W closes the active tab and falls back to workspace.close on last tab", () => {
    useWorkspaceLayout.setState({ layout: emptyWindowLayout("/ws-a") });
    useWorkspaceLayout.getState().addWorkspaceTab("/ws-b");
    mount();
    expect(activeTabsNodeSize()).toBe(2);
    fire("w", { meta: true });
    expect(activeTabsNodeSize()).toBe(1);
    fire("w", { meta: true });
    expect(useWorkspace.getState().current).toBeNull();
  });

  it("Mod+\\ splits vertically", () => {
    useWorkspaceLayout.setState({ layout: emptyWindowLayout("/ws-a") });
    mount();
    fire("\\", { meta: true });
    expect(useWorkspaceLayout.getState().layout?.root.type).toBe("ws-split");
  });

  it("Mod+Shift+\\ splits horizontally (key='\\\\')", () => {
    useWorkspaceLayout.setState({ layout: emptyWindowLayout("/ws-a") });
    mount();
    fire("\\", { meta: true, shift: true });
    const root = useWorkspaceLayout.getState().layout?.root;
    expect(root?.type).toBe("ws-split");
    if (root?.type === "ws-split") expect(root.direction).toBe("vertical");
  });

  it("Mod+Shift+\\ also matches key='|' (shifted backslash)", () => {
    useWorkspaceLayout.setState({ layout: emptyWindowLayout("/ws-a") });
    mount();
    fire("|", { meta: true, shift: true });
    expect(useWorkspaceLayout.getState().layout?.root.type).toBe("ws-split");
  });

  it("Mod+1..9 is a noop when root is a single ws-tabs (D7 fallback)", () => {
    useWorkspaceLayout.setState({ layout: emptyWindowLayout("/ws-a") });
    useWorkspaceLayout.getState().addWorkspaceTab("/ws-b");
    mount();
    const before = useWorkspaceLayout.getState().layout?.activeTabId;
    const evt = fire("1", { meta: true });
    expect(evt.defaultPrevented).toBe(false);
    expect(useWorkspaceLayout.getState().layout?.activeTabId).toBe(before);
  });

  it("Mod+N jumps to nth workspace tab when a split exists", () => {
    useWorkspaceLayout.setState({ layout: emptyWindowLayout("/ws-a") });
    useWorkspaceLayout.getState().splitVertical();
    useWorkspaceLayout.getState().addWorkspaceTab("/ws-c");
    mount();
    const layout = useWorkspaceLayout.getState().layout;
    if (!layout) throw new Error("setup");
    let firstId: string | null = null;
    forEachTabsNode(layout.root, (n) => {
      if (n.tabs.some((t) => t.id === layout.activeTabId)) {
        firstId = n.tabs[0]?.id ?? null;
        return false;
      }
    });
    fire("1", { meta: true });
    expect(useWorkspaceLayout.getState().layout?.activeTabId).toBe(firstId);
  });

  it("Mod+N is a noop when the index is out of range", () => {
    useWorkspaceLayout.setState({ layout: emptyWindowLayout("/ws-a") });
    useWorkspaceLayout.getState().splitVertical();
    mount();
    const before = useWorkspaceLayout.getState().layout?.activeTabId;
    fire("9", { meta: true });
    expect(useWorkspaceLayout.getState().layout?.activeTabId).toBe(before);
  });

  it("Mod+N is a noop when the active id cannot be located", () => {
    useWorkspaceLayout.setState({ layout: emptyWindowLayout("/ws-a") });
    useWorkspaceLayout.getState().splitVertical();
    const layout = useWorkspaceLayout.getState().layout;
    if (!layout) throw new Error("setup");
    useWorkspaceLayout.setState({ layout: { ...layout, activeTabId: "orphan" } });
    mount();
    const evt = fire("1", { meta: true });
    expect(evt.defaultPrevented).toBe(false);
  });

  it("non-mod keys are ignored", () => {
    useWorkspaceLayout.setState({ layout: emptyWindowLayout("/ws-a") });
    mount();
    fire("t");
    fire("w");
    fire("\\");
    expect(activeTabsNodeSize()).toBe(1);
  });

  it("non-Mac platform uses ctrlKey for the modifier", () => {
    setPlatform("Win32");
    useWorkspaceLayout.setState({ layout: emptyWindowLayout("/ws-a") });
    mount();
    fire("t", { ctrl: true });
    expect(activeTabsNodeSize()).toBe(2);
  });

  it("removes its listener on unmount", () => {
    useWorkspaceLayout.setState({ layout: emptyWindowLayout("/ws-a") });
    const h = renderHook(() => useWorkspaceShellShortcuts());
    h.unmount();
    fire("t", { meta: true });
    expect(activeTabsNodeSize()).toBe(1);
  });

  it("activeTabsNodeSize returns 0 when no layout is present", () => {
    useWorkspaceLayout.setState({ layout: null });
    expect(activeTabsNodeSize()).toBe(0);
  });

  it("activeTabsNodeSize returns 0 when active id is in no node", () => {
    const t1 = createWorkspaceTab("/a");
    const node = createTabsNode([t1], t1.id);
    useWorkspaceLayout.setState({
      layout: { schemaVersion: 2, root: node, activeTabId: "missing" },
    });
    expect(activeTabsNodeSize()).toBe(0);
  });

  // ADR-0019 scope gate: bindings stand down when no workspace is open
  // (Welcome screen). `current: null` short-circuits before the layout
  // guard — no throw, no mutation, even if a layout somehow lingers.
  it("yields when no workspace is open", () => {
    useWorkspace.setState({ current: null });
    useWorkspaceLayout.setState({ layout: emptyWindowLayout("/ws-a") });
    mount();
    const sizeBefore = activeTabsNodeSize();
    fire("t", { meta: true });
    expect(activeTabsNodeSize()).toBe(sizeBefore);
  });

  // The complementary branch: a workspace is open so the gate passes,
  // and the inner layout guard then runs (here there is no layout, so
  // the handler still bails — no throw, no state mutation).
  it("passes the scope gate when a workspace is open, then the layout guard runs", () => {
    useWorkspace.setState({ current: "/ws-a" });
    useWorkspaceLayout.setState({ layout: null });
    mount();
    fire("t", { meta: true });
    expect(useWorkspaceLayout.getState().layout).toBeNull();
  });

  // MAR-1015: Mod+Alt+Arrow split focus navigation matrix on a 2x2 split.
  describe("Mod+Alt+Arrow split focus navigation (MAR-1015)", () => {
    function build2x2(): {
      ids: { tl: string; tr: string; bl: string; br: string };
      tabIds: { tl: string; tr: string; bl: string; br: string };
    } {
      // Build a 2x2 grid: outer split is vertical (top-row / bottom-row);
      // each row is a horizontal split (left / right).
      useWorkspaceLayout.setState({ layout: emptyWindowLayout("/ws-a") });
      useWorkspaceLayout.getState().splitVertical(); // horizontal (left|right)
      useWorkspaceLayout.getState().splitHorizontal(); // vertical (top/bottom) of the right side
      // Now the right column has top/bottom. Split the left column too.
      const layout = useWorkspaceLayout.getState().layout;
      if (!layout || layout.root.type !== "ws-split") throw new Error("bad setup");
      // Find the left ws-tabs node, set it active, then split horizontally.
      const leftFirstTab = (() => {
        const firstChild = layout.root.children[0];
        if (!firstChild || firstChild.type !== "ws-tabs") return null;
        return firstChild.tabs[0]?.id ?? null;
      })();
      if (!leftFirstTab) throw new Error("expected left tab");
      useWorkspaceLayout.getState().setActiveTab(leftFirstTab);
      useWorkspaceLayout.getState().splitHorizontal();
      const final = useWorkspaceLayout.getState().layout;
      if (!final || final.root.type !== "ws-split") throw new Error("expected outer split");
      // Layout shape: ws-split horizontal [leftCol, rightCol]
      //   leftCol  = ws-split vertical [tlTabs, blTabs]
      //   rightCol = ws-split vertical [trTabs, brTabs]
      const root = final.root;
      const leftCol = root.children[0];
      const rightCol = root.children[1];
      if (!leftCol || leftCol.type !== "ws-split") throw new Error("leftCol");
      if (!rightCol || rightCol.type !== "ws-split") throw new Error("rightCol");
      const tlTabs = leftCol.children[0];
      const blTabs = leftCol.children[1];
      const trTabs = rightCol.children[0];
      const brTabs = rightCol.children[1];
      if (
        !tlTabs ||
        !blTabs ||
        !trTabs ||
        !brTabs ||
        tlTabs.type !== "ws-tabs" ||
        blTabs.type !== "ws-tabs" ||
        trTabs.type !== "ws-tabs" ||
        brTabs.type !== "ws-tabs"
      ) {
        throw new Error("expected 4 leaves");
      }
      return {
        ids: { tl: tlTabs.id, tr: trTabs.id, bl: blTabs.id, br: brTabs.id },
        tabIds: {
          tl: tlTabs.tabs[0]?.id ?? "",
          tr: trTabs.tabs[0]?.id ?? "",
          bl: blTabs.tabs[0]?.id ?? "",
          br: brTabs.tabs[0]?.id ?? "",
        },
      };
    }

    it("computeLeafRects partitions the unit square per split", () => {
      const { ids } = build2x2();
      const layout = useWorkspaceLayout.getState().layout;
      if (!layout) throw new Error("layout");
      const rects = computeLeafRects(layout.root);
      expect(rects).toHaveLength(4);
      const tl = rects.find((r) => r.nodeId === ids.tl);
      const br = rects.find((r) => r.nodeId === ids.br);
      expect(tl?.x0).toBeCloseTo(0);
      expect(tl?.y0).toBeCloseTo(0);
      expect(br?.x1).toBeCloseTo(1);
      expect(br?.y1).toBeCloseTo(1);
    });

    it("pickNeighbourLeaf returns null when active leaf is missing", () => {
      const layout = useWorkspaceLayout.getState().layout;
      const rects = layout ? computeLeafRects(layout.root) : [];
      expect(pickNeighbourLeaf(rects, "ghost", "left")).toBeNull();
    });

    it("Mod+Alt+Right moves focus from top-left to top-right", () => {
      const { ids, tabIds } = build2x2();
      useWorkspaceLayout.getState().setActiveTab(tabIds.tl);
      mount();
      const evt = fire("ArrowRight", { meta: true, alt: true });
      expect(evt.defaultPrevented).toBe(true);
      // Active tab should belong to top-right's tabs node.
      const layout = useWorkspaceLayout.getState().layout;
      if (!layout) throw new Error("layout");
      const located = layout?.activeTabId;
      const nodeId = (() => {
        let id = "";
        forEachTabsNode(layout.root, (n) => {
          if (n.tabs.some((t) => t.id === located)) {
            id = n.id;
            return false;
          }
        });
        return id;
      })();
      expect(nodeId).toBe(ids.tr);
    });

    it("Mod+Alt+Down moves focus to the leaf below", () => {
      const { ids, tabIds } = build2x2();
      useWorkspaceLayout.getState().setActiveTab(tabIds.tl);
      mount();
      fire("ArrowDown", { meta: true, alt: true });
      const layout = useWorkspaceLayout.getState().layout;
      if (!layout) throw new Error("layout");
      const located = layout.activeTabId;
      let nodeId = "";
      forEachTabsNode(layout.root, (n) => {
        if (n.tabs.some((t) => t.id === located)) {
          nodeId = n.id;
          return false;
        }
      });
      expect(nodeId).toBe(ids.bl);
    });

    it("Mod+Alt+Left from top-left is a noop (no neighbour)", () => {
      const { tabIds } = build2x2();
      useWorkspaceLayout.getState().setActiveTab(tabIds.tl);
      mount();
      const evt = fire("ArrowLeft", { meta: true, alt: true });
      expect(evt.defaultPrevented).toBe(false);
      expect(useWorkspaceLayout.getState().layout?.activeTabId).toBe(tabIds.tl);
    });

    it("Mod+Alt+Up from bottom-right lands in top-right", () => {
      const { ids, tabIds } = build2x2();
      useWorkspaceLayout.getState().setActiveTab(tabIds.br);
      mount();
      fire("ArrowUp", { meta: true, alt: true });
      const layout = useWorkspaceLayout.getState().layout;
      if (!layout) throw new Error("layout");
      const located = layout.activeTabId;
      let nodeId = "";
      forEachTabsNode(layout.root, (n) => {
        if (n.tabs.some((t) => t.id === located)) {
          nodeId = n.id;
          return false;
        }
      });
      expect(nodeId).toBe(ids.tr);
    });

    it("Mod+Alt+Arrow is a noop on a single ws-tabs root", () => {
      useWorkspaceLayout.setState({ layout: emptyWindowLayout("/ws-a") });
      mount();
      const evt = fire("ArrowRight", { meta: true, alt: true });
      expect(evt.defaultPrevented).toBe(false);
    });

    it("focusSplitInDirection returns false without a layout", () => {
      useWorkspaceLayout.setState({ layout: null });
      expect(focusSplitInDirection("left")).toBe(false);
    });

    it("focusSplitInDirection returns false when root is a single ws-tabs", () => {
      useWorkspaceLayout.setState({ layout: emptyWindowLayout("/ws-a") });
      expect(focusSplitInDirection("left")).toBe(false);
    });

    it("focusSplitInDirection returns false when active id is orphaned", () => {
      const { tabIds } = build2x2();
      void tabIds;
      const layout = useWorkspaceLayout.getState().layout;
      if (!layout) throw new Error("layout");
      useWorkspaceLayout.setState({ layout: { ...layout, activeTabId: "ghost" } });
      expect(focusSplitInDirection("right")).toBe(false);
    });

    it("focusSplitInDirection returns false at the edge of the grid", () => {
      const { tabIds } = build2x2();
      useWorkspaceLayout.getState().setActiveTab(tabIds.br);
      expect(focusSplitInDirection("right")).toBe(false);
    });

    it("pickNeighbourLeaf prefers larger perpendicular overlap on ties (right)", () => {
      // Synthesize three candidate rects with the same direction-axis
      // distance from the active leaf — the helper should prefer the one
      // with the larger overlap span.
      const rects = [
        { nodeId: "active", x0: 0, y0: 0, x1: 0.5, y1: 1 },
        { nodeId: "tiny", x0: 0.5, y0: 0, x1: 1, y1: 0.2 },
        { nodeId: "big", x0: 0.5, y0: 0, x1: 1, y1: 0.9 },
      ];
      expect(pickNeighbourLeaf(rects, "active", "right")?.nodeId).toBe("big");
    });

    it("pickNeighbourLeaf prefers larger perpendicular overlap on ties (down)", () => {
      // Two candidates both directly below the active leaf at the same
      // distance — picker must walk the "down" branch of the sort and
      // pick the one with the wider x-overlap.
      const rects = [
        { nodeId: "active", x0: 0, y0: 0, x1: 1, y1: 0.5 },
        { nodeId: "tiny", x0: 0, y0: 0.5, x1: 0.2, y1: 1 },
        { nodeId: "big", x0: 0, y0: 0.5, x1: 0.9, y1: 1 },
      ];
      expect(pickNeighbourLeaf(rects, "active", "down")?.nodeId).toBe("big");
    });

    it("pickNeighbourLeaf prefers larger perpendicular overlap on ties (up)", () => {
      const rects = [
        { nodeId: "active", x0: 0, y0: 0.5, x1: 1, y1: 1 },
        { nodeId: "tiny", x0: 0, y0: 0, x1: 0.2, y1: 0.5 },
        { nodeId: "big", x0: 0, y0: 0, x1: 0.9, y1: 0.5 },
      ];
      expect(pickNeighbourLeaf(rects, "active", "up")?.nodeId).toBe("big");
    });

    it("pickNeighbourLeaf prefers larger perpendicular overlap on ties (left)", () => {
      const rects = [
        { nodeId: "active", x0: 0.5, y0: 0, x1: 1, y1: 1 },
        { nodeId: "tiny", x0: 0, y0: 0, x1: 0.5, y1: 0.2 },
        { nodeId: "big", x0: 0, y0: 0, x1: 0.5, y1: 0.9 },
      ];
      expect(pickNeighbourLeaf(rects, "active", "left")?.nodeId).toBe("big");
    });
  });
});
