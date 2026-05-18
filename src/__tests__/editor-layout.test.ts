// S-ESP-003: split / close / resize semantics for the editor layout store.

import { beforeEach, describe, expect, it } from "vitest";
import {
  findPane,
  forEachPane,
  type LayoutNode,
  type PaneNode,
  type SplitNode,
  type WorkspaceLayout,
} from "../lib/editor/layout-model";
import { useEditorLayout } from "../store/editor-layout";
import { regionForPoint } from "../components/PaneDropZone";

const WS = "/tmp/test-ws";

function fresh(): WorkspaceLayout {
  return useEditorLayout.getState().ensureLayout(WS);
}

function layout(): WorkspaceLayout {
  return useEditorLayout.getState().getLayout(WS);
}

function panes(root: LayoutNode): PaneNode[] {
  const out: PaneNode[] = [];
  forEachPane(root, (p) => {
    out.push(p);
  });
  return out;
}

beforeEach(() => {
  useEditorLayout.setState({ layouts: {} });
  fresh();
});

describe("editor-layout store", () => {
  it("starts with a single empty pane", () => {
    const l = layout();
    expect(l.root.type).toBe("pane");
    expect(panes(l.root)).toHaveLength(1);
    expect(l.activePaneId).toBe(l.root.id);
  });

  it("splits horizontally on the right", () => {
    const initial = layout().root.id;
    const newPaneId = useEditorLayout
      .getState()
      .splitPane(WS, initial, "horizontal", "after");
    expect(newPaneId).not.toBeNull();
    const l = layout();
    expect(l.root.type).toBe("split");
    const split = l.root as SplitNode;
    expect(split.direction).toBe("horizontal");
    expect(split.children).toHaveLength(2);
    expect(split.children[0]?.id).toBe(initial);
    expect(split.children[1]?.id).toBe(newPaneId);
    expect(split.sizes).toEqual([0.5, 0.5]);
    expect(l.activePaneId).toBe(newPaneId);
  });

  it("splits vertically on the left (before)", () => {
    const initial = layout().root.id;
    const newId = useEditorLayout
      .getState()
      .splitPane(WS, initial, "vertical", "before");
    const split = layout().root as SplitNode;
    expect(split.direction).toBe("vertical");
    expect(split.children[0]?.id).toBe(newId);
    expect(split.children[1]?.id).toBe(initial);
  });

  it("keeps the tree flat when extending an existing split", () => {
    const a = layout().root.id;
    const b = useEditorLayout.getState().splitPane(WS, a, "horizontal", "after");
    const c = useEditorLayout
      .getState()
      .splitPane(WS, b!, "horizontal", "after");
    const root = layout().root as SplitNode;
    expect(root.type).toBe("split");
    expect(root.children).toHaveLength(3);
    expect(root.children.map((n) => n.id)).toEqual([a, b, c]);
    expect(root.sizes.every((s) => Math.abs(s - 1 / 3) < 1e-6)).toBe(true);
  });

  it("nests when the new split is perpendicular", () => {
    const a = layout().root.id;
    const b = useEditorLayout.getState().splitPane(WS, a, "horizontal", "after");
    const c = useEditorLayout.getState().splitPane(WS, b!, "vertical", "after");
    const root = layout().root as SplitNode;
    expect(root.direction).toBe("horizontal");
    expect(root.children).toHaveLength(2);
    const right = root.children[1] as SplitNode;
    expect(right.type).toBe("split");
    expect(right.direction).toBe("vertical");
    expect(right.children.map((n) => n.id)).toEqual([b, c]);
  });

  it("collapses the parent split when only one child remains", () => {
    const a = layout().root.id;
    const b = useEditorLayout.getState().splitPane(WS, a, "horizontal", "after");
    useEditorLayout.getState().closePane(WS, b!);
    const root = layout().root;
    expect(root.type).toBe("pane");
    expect(root.id).toBe(a);
  });

  it("removes a single child from a 3-way split without flattening", () => {
    const a = layout().root.id;
    const b = useEditorLayout.getState().splitPane(WS, a, "horizontal", "after")!;
    const c = useEditorLayout.getState().splitPane(WS, b, "horizontal", "after")!;
    useEditorLayout.getState().closePane(WS, b);
    const root = layout().root as SplitNode;
    expect(root.type).toBe("split");
    expect(root.children.map((n) => n.id)).toEqual([a, c]);
  });

  it("falls back to an empty pane if the whole tree is closed", () => {
    const a = layout().root.id;
    useEditorLayout.getState().closePane(WS, a);
    const root = layout().root;
    expect(root.type).toBe("pane");
    expect((root as PaneNode).tabs).toEqual([]);
  });

  it("setSizes normalises and ignores mismatched lengths", () => {
    const a = layout().root.id;
    useEditorLayout.getState().splitPane(WS, a, "horizontal", "after");
    const split = layout().root as SplitNode;
    useEditorLayout.getState().setSizes(WS, split.id, [3, 1]);
    const next = layout().root as SplitNode;
    expect(next.sizes[0]).toBeCloseTo(0.75);
    expect(next.sizes[1]).toBeCloseTo(0.25);
    useEditorLayout.getState().setSizes(WS, split.id, [1, 1, 1]);
    const same = layout().root as SplitNode;
    expect(same.sizes[0]).toBeCloseTo(0.75);
  });

  it("setActivePane refuses unknown ids", () => {
    const a = layout().root.id;
    useEditorLayout.getState().setActivePane(WS, "pane-bogus");
    expect(layout().activePaneId).toBe(a);
  });

  it("moves a tab between panes and collapses the source when empty", () => {
    // Set up: pane A with one tab, split right to create pane B (empty).
    const a = layout().root.id;
    const b = useEditorLayout.getState().splitPane(WS, a, "horizontal", "after")!;
    // Inject a tab directly into A.
    const tab = {
      id: "tab-1",
      path: "/ws/foo.md",
      position: { line: 0, column: 0, scrollTop: 0 },
    };
    useEditorLayout.setState((s) => {
      const root = s.layouts[WS]!.root as SplitNode;
      const aPane = root.children[0] as PaneNode;
      const newRoot: SplitNode = {
        ...root,
        children: [{ ...aPane, tabs: [tab], activeTabId: tab.id }, root.children[1]!],
      };
      return { layouts: { ...s.layouts, [WS]: { ...s.layouts[WS]!, root: newRoot } } };
    });
    const ok = useEditorLayout.getState().moveTab(WS, a, "tab-1", b, null);
    expect(ok).toBe(true);
    // Source pane was the only-content pane — it should have collapsed away.
    const root = layout().root as PaneNode;
    expect(root.type).toBe("pane");
    expect(root.id).toBe(b);
    expect(root.tabs).toHaveLength(1);
    expect(root.tabs[0]?.id).toBe("tab-1");
    expect(root.activeTabId).toBe("tab-1");
  });

  it("splitWithTab creates a new pane and moves the tab into it", () => {
    const a = layout().root.id;
    const b = useEditorLayout.getState().splitPane(WS, a, "horizontal", "after")!;
    // Inject two tabs into A so the source pane survives the move.
    const tabA = { id: "tab-a", path: "/ws/a.md", position: { line: 0, column: 0, scrollTop: 0 } };
    const tabB = { id: "tab-b", path: "/ws/b.md", position: { line: 0, column: 0, scrollTop: 0 } };
    useEditorLayout.setState((s) => {
      const root = s.layouts[WS]!.root as SplitNode;
      const aPane = root.children[0] as PaneNode;
      const newRoot: SplitNode = {
        ...root,
        children: [{ ...aPane, tabs: [tabA, tabB], activeTabId: tabA.id }, root.children[1]!],
      };
      return { layouts: { ...s.layouts, [WS]: { ...s.layouts[WS]!, root: newRoot } } };
    });
    const newPaneId = useEditorLayout
      .getState()
      .splitWithTab(WS, a, "tab-b", b, "vertical", "after");
    expect(newPaneId).not.toBeNull();
    const root = layout().root as SplitNode;
    expect(root.type).toBe("split");
    expect(root.direction).toBe("horizontal");
    expect(root.children).toHaveLength(2);
    // Right child should now be a vertical split with [b, newPane].
    const right = root.children[1] as SplitNode;
    expect(right.type).toBe("split");
    expect(right.direction).toBe("vertical");
    const moved = right.children[1] as PaneNode;
    expect(moved.tabs.map((t) => t.id)).toEqual(["tab-b"]);
    expect(moved.activeTabId).toBe("tab-b");
    // Source A should keep only tab-a.
    const aPane = root.children[0] as PaneNode;
    expect(aPane.tabs.map((t) => t.id)).toEqual(["tab-a"]);
    expect(layout().activePaneId).toBe(newPaneId);
  });

  it("splitWithTab refuses when source is the only pane with the only tab", () => {
    const a = layout().root.id;
    const tab = { id: "tab-1", path: "/ws/x.md", position: { line: 0, column: 0, scrollTop: 0 } };
    useEditorLayout.setState((s) => ({
      layouts: {
        ...s.layouts,
        [WS]: {
          ...s.layouts[WS]!,
          root: { type: "pane", id: a, tabs: [tab], activeTabId: tab.id },
        },
      },
    }));
    const newPaneId = useEditorLayout
      .getState()
      .splitWithTab(WS, a, "tab-1", a, "horizontal", "after");
    expect(newPaneId).toBeNull();
  });

  it("setTabPosition stores per-pane positions independently", () => {
    // Two panes both pointing at the same path; their positions must not bleed.
    const a = layout().root.id;
    const b = useEditorLayout.getState().splitPane(WS, a, "horizontal", "after")!;
    const tabA = {
      id: "tab-a",
      path: "/ws/same.md",
      position: { line: 0, column: 0, scrollTop: 0 },
    };
    const tabB = {
      id: "tab-b",
      path: "/ws/same.md",
      position: { line: 0, column: 0, scrollTop: 0 },
    };
    useEditorLayout.setState((s) => {
      const root = s.layouts[WS]!.root as SplitNode;
      const aPane = root.children[0] as PaneNode;
      const bPane = root.children[1] as PaneNode;
      const next: SplitNode = {
        ...root,
        children: [
          { ...aPane, tabs: [tabA], activeTabId: "tab-a" },
          { ...bPane, tabs: [tabB], activeTabId: "tab-b" },
        ],
      };
      return { layouts: { ...s.layouts, [WS]: { ...s.layouts[WS]!, root: next } } };
    });
    useEditorLayout.getState().setTabPosition(WS, a, "tab-a", { line: 10, column: 5, scrollTop: 200 });
    useEditorLayout.getState().setTabPosition(WS, b, "tab-b", { line: 42, column: 0, scrollTop: 1500 });
    const root = layout().root as SplitNode;
    const aPane = root.children[0] as PaneNode;
    const bPane = root.children[1] as PaneNode;
    expect(aPane.tabs[0]?.position).toEqual({ line: 10, column: 5, scrollTop: 200 });
    expect(bPane.tabs[0]?.position).toEqual({ line: 42, column: 0, scrollTop: 1500 });
  });

  it("setActiveTab focuses the pane and selects the tab", () => {
    const a = layout().root.id;
    const b = useEditorLayout.getState().splitPane(WS, a, "horizontal", "after")!;
    const t1 = { id: "t1", path: "/ws/a.md", position: { line: 0, column: 0, scrollTop: 0 } };
    const t2 = { id: "t2", path: "/ws/b.md", position: { line: 0, column: 0, scrollTop: 0 } };
    useEditorLayout.setState((s) => {
      const root = s.layouts[WS]!.root as SplitNode;
      const aPane = root.children[0] as PaneNode;
      const next: SplitNode = {
        ...root,
        children: [{ ...aPane, tabs: [t1, t2], activeTabId: "t1" }, root.children[1]!],
      };
      return { layouts: { ...s.layouts, [WS]: { ...s.layouts[WS]!, root: next, activePaneId: b } } };
    });
    useEditorLayout.getState().setActiveTab(WS, a, "t2");
    const root = layout().root as SplitNode;
    const aPane = root.children[0] as PaneNode;
    expect(aPane.activeTabId).toBe("t2");
    expect(layout().activePaneId).toBe(a);
    // unknown tab id is a no-op
    useEditorLayout.getState().setActiveTab(WS, a, "nope");
    expect((layout().root as SplitNode).children[0] as PaneNode).toMatchObject({
      activeTabId: "t2",
    });
  });

  it("regionForPoint maps coordinates to drop regions", () => {
    const rect = { left: 0, top: 0, width: 100, height: 100 };
    expect(regionForPoint(50, 50, rect)).toBe("center");
    expect(regionForPoint(5, 50, rect)).toBe("left");
    expect(regionForPoint(95, 50, rect)).toBe("right");
    expect(regionForPoint(50, 5, rect)).toBe("top");
    expect(regionForPoint(50, 95, rect)).toBe("bottom");
    // Just past the 30% edge → center.
    expect(regionForPoint(35, 50, rect)).toBe("center");
  });

  it("findPane locates panes by id across the tree", () => {
    const a = layout().root.id;
    const b = useEditorLayout.getState().splitPane(WS, a, "horizontal", "after")!;
    const c = useEditorLayout.getState().splitPane(WS, b, "vertical", "after")!;
    expect(findPane(layout().root, a)?.id).toBe(a);
    expect(findPane(layout().root, b)?.id).toBe(b);
    expect(findPane(layout().root, c)?.id).toBe(c);
    expect(findPane(layout().root, "pane-nope")).toBeNull();
  });
});
