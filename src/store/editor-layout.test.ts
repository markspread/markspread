// S-ESP-003 / S-ESP-004 / S-ESP-006: editor-layout store mutations.

import { beforeEach, describe, expect, it } from "vitest";
import type { PaneNode, PaneTab, SplitNode } from "../lib/editor/layout-model";
import { useEditorLayout } from "./editor-layout";

const WS = "/ws";

function tab(id: string, path = `${id}.md`): PaneTab {
  return { id, path, position: { line: 0, column: 0, scrollTop: 0 } };
}

function paneOfRoot(): PaneNode {
  const layout = useEditorLayout.getState().getLayout(WS);
  return layout.root as PaneNode;
}

beforeEach(() => {
  useEditorLayout.setState({ layouts: {} });
});

describe("useEditorLayout — basic lifecycle", () => {
  it("getLayout returns an empty layout for an unknown workspace", () => {
    const layout = useEditorLayout.getState().getLayout("missing");
    expect(layout.root.type).toBe("pane");
    expect(layout.activePaneId).toBe((layout.root as PaneNode).id);
  });

  it("ensureLayout creates and persists a fresh layout once", () => {
    const a = useEditorLayout.getState().ensureLayout(WS);
    const b = useEditorLayout.getState().ensureLayout(WS);
    expect(a.activePaneId).toBe(b.activePaneId);
  });

  it("setLayout swaps in a caller-provided layout wholesale", () => {
    useEditorLayout.getState().ensureLayout(WS);
    const root: PaneNode = { type: "pane", id: "p-x", tabs: [], activeTabId: null };
    useEditorLayout.getState().setLayout(WS, { schemaVersion: 1, root, activePaneId: "p-x" });
    expect(useEditorLayout.getState().getLayout(WS).activePaneId).toBe("p-x");
  });
});

describe("useEditorLayout — splitPane", () => {
  it("returns null for an unknown workspace or pane", () => {
    expect(useEditorLayout.getState().splitPane("missing", "p", "horizontal", "after")).toBeNull();
    useEditorLayout.getState().ensureLayout(WS);
    expect(
      useEditorLayout.getState().splitPane(WS, "missing-pane", "horizontal", "after"),
    ).toBeNull();
  });

  it("turns a single pane into a horizontal split", () => {
    useEditorLayout.getState().ensureLayout(WS);
    const first = paneOfRoot();
    const newId = useEditorLayout.getState().splitPane(WS, first.id, "horizontal", "after");
    expect(newId).not.toBeNull();
    const root = useEditorLayout.getState().getLayout(WS).root as SplitNode;
    expect(root.type).toBe("split");
    expect(root.direction).toBe("horizontal");
    expect(root.children).toHaveLength(2);
  });

  it("extends an existing split when the direction matches (no nested splits)", () => {
    useEditorLayout.getState().ensureLayout(WS);
    const first = paneOfRoot();
    useEditorLayout.getState().splitPane(WS, first.id, "horizontal", "after");
    const splitAfterFirst = useEditorLayout.getState().getLayout(WS).root as SplitNode;
    const lastChildId = splitAfterFirst.children[splitAfterFirst.children.length - 1]?.id ?? "";
    useEditorLayout.getState().splitPane(WS, lastChildId, "horizontal", "after");
    const root = useEditorLayout.getState().getLayout(WS).root as SplitNode;
    // Flat 3-child split — not ((A|B)|C).
    expect(root.children).toHaveLength(3);
    for (const c of root.children) expect(c.type).toBe("pane");
  });

  it("inserts the new pane on the requested side", () => {
    useEditorLayout.getState().ensureLayout(WS);
    const first = paneOfRoot();
    const newId = useEditorLayout.getState().splitPane(WS, first.id, "vertical", "before");
    const root = useEditorLayout.getState().getLayout(WS).root as SplitNode;
    expect(root.children[0]?.id).toBe(newId);
  });

  it("recurses into nested splits when extending the parent", () => {
    useEditorLayout.getState().ensureLayout(WS);
    const first = paneOfRoot();
    // First split horizontally — root becomes [first, b].
    useEditorLayout.getState().splitPane(WS, first.id, "horizontal", "after");
    let root = useEditorLayout.getState().getLayout(WS).root as SplitNode;
    const innerPaneId = root.children[1]?.id ?? "";
    // Now split the right child vertically — root[1] becomes a vertical split.
    useEditorLayout.getState().splitPane(WS, innerPaneId, "vertical", "after");
    root = useEditorLayout.getState().getLayout(WS).root as SplitNode;
    expect(root.direction).toBe("horizontal");
    const nested = root.children[1] as SplitNode;
    expect(nested.type).toBe("split");
    expect(nested.direction).toBe("vertical");
    // Extend the nested vertical split — should append in place.
    const deepPaneId = nested.children[0]?.id ?? "";
    useEditorLayout.getState().splitPane(WS, deepPaneId, "vertical", "after");
    const root2 = useEditorLayout.getState().getLayout(WS).root as SplitNode;
    const nested2 = root2.children[1] as SplitNode;
    expect(nested2.children).toHaveLength(3);
  });
});

describe("useEditorLayout — closePane / setSizes", () => {
  it("closePane collapses a 2-pane split back to a single pane", () => {
    useEditorLayout.getState().ensureLayout(WS);
    const first = paneOfRoot();
    const newId = useEditorLayout.getState().splitPane(WS, first.id, "horizontal", "after");
    if (!newId) throw new Error("split failed");
    useEditorLayout.getState().closePane(WS, newId);
    expect(useEditorLayout.getState().getLayout(WS).root.type).toBe("pane");
  });

  it("closePane falls back to an empty pane when the whole tree is collapsed", () => {
    useEditorLayout.getState().ensureLayout(WS);
    const first = paneOfRoot();
    useEditorLayout.getState().closePane(WS, first.id);
    const layout = useEditorLayout.getState().getLayout(WS);
    expect(layout.root.type).toBe("pane");
    expect((layout.root as PaneNode).tabs).toEqual([]);
  });

  it("closePane preserves the active pane when it survives the collapse", () => {
    useEditorLayout.getState().ensureLayout(WS);
    const first = paneOfRoot();
    const right = useEditorLayout.getState().splitPane(WS, first.id, "horizontal", "after");
    if (!right) throw new Error("split failed");
    // Re-focus the left pane, then close the right one — left.id should still
    // be the active pane after the split collapses.
    useEditorLayout.getState().setActivePane(WS, first.id);
    useEditorLayout.getState().closePane(WS, right);
    expect(useEditorLayout.getState().getLayout(WS).activePaneId).toBe(first.id);
  });

  it("closePane is a no-op when the workspace or pane is missing", () => {
    useEditorLayout.getState().closePane("missing", "p");
    useEditorLayout.getState().ensureLayout(WS);
    useEditorLayout.getState().closePane(WS, "no-such");
    expect(useEditorLayout.getState().getLayout(WS).root.type).toBe("pane");
  });

  it("setSizes renormalises and applies caller-provided sizes", () => {
    useEditorLayout.getState().ensureLayout(WS);
    const first = paneOfRoot();
    useEditorLayout.getState().splitPane(WS, first.id, "horizontal", "after");
    const split = useEditorLayout.getState().getLayout(WS).root as SplitNode;
    useEditorLayout.getState().setSizes(WS, split.id, [3, 1]);
    const next = useEditorLayout.getState().getLayout(WS).root as SplitNode;
    expect(next.sizes[0]).toBeCloseTo(0.75, 5);
    expect(next.sizes[1]).toBeCloseTo(0.25, 5);
  });

  it("setSizes ignores mismatched array lengths and missing workspaces", () => {
    useEditorLayout.getState().setSizes("missing", "s", [0.5, 0.5]);
    useEditorLayout.getState().ensureLayout(WS);
    const first = paneOfRoot();
    useEditorLayout.getState().splitPane(WS, first.id, "horizontal", "after");
    const split = useEditorLayout.getState().getLayout(WS).root as SplitNode;
    const prevSizes = split.sizes.slice();
    useEditorLayout.getState().setSizes(WS, split.id, [1]);
    expect((useEditorLayout.getState().getLayout(WS).root as SplitNode).sizes).toEqual(prevSizes);
  });

  it("setSizes ignores all-zero sizes by falling back to /1", () => {
    useEditorLayout.getState().ensureLayout(WS);
    const first = paneOfRoot();
    useEditorLayout.getState().splitPane(WS, first.id, "horizontal", "after");
    const split = useEditorLayout.getState().getLayout(WS).root as SplitNode;
    useEditorLayout.getState().setSizes(WS, split.id, [0, 0]);
    const next = useEditorLayout.getState().getLayout(WS).root as SplitNode;
    expect(next.sizes).toEqual([0, 0]);
  });
});

describe("useEditorLayout — moveTab", () => {
  it("returns false when workspace / pane / tab can't be resolved", () => {
    expect(useEditorLayout.getState().moveTab("missing", "p", "t", "p2", null)).toBe(false);
    useEditorLayout.getState().ensureLayout(WS);
    const first = paneOfRoot();
    expect(useEditorLayout.getState().moveTab(WS, "no-pane", "t", first.id, null)).toBe(false);
    expect(useEditorLayout.getState().moveTab(WS, first.id, "no-tab", first.id, null)).toBe(false);
  });

  it("returns false on a no-op same-pane reorder to the same slot", () => {
    useEditorLayout.getState().ensureLayout(WS);
    const first = paneOfRoot();
    const layout = useEditorLayout.getState().getLayout(WS);
    useEditorLayout.getState().setLayout(WS, {
      ...layout,
      root: { ...first, tabs: [tab("t1"), tab("t2")], activeTabId: "t1" },
    });
    // No-op: target index equals current index of t1 (0).
    expect(useEditorLayout.getState().moveTab(WS, first.id, "t1", first.id, 0)).toBe(false);
    // Also no-op when toIndex is null and tab is already at the tail.
    expect(useEditorLayout.getState().moveTab(WS, first.id, "t2", first.id, null)).toBe(false);
  });

  it("reorders a tab within the same pane", () => {
    useEditorLayout.getState().ensureLayout(WS);
    const first = paneOfRoot();
    useEditorLayout.getState().setLayout(WS, {
      schemaVersion: 1,
      root: { ...first, tabs: [tab("t1"), tab("t2"), tab("t3")], activeTabId: "t1" },
      activePaneId: first.id,
    });
    expect(useEditorLayout.getState().moveTab(WS, first.id, "t3", first.id, 0)).toBe(true);
    const root = useEditorLayout.getState().getLayout(WS).root as PaneNode;
    expect(root.tabs.map((t) => t.id)).toEqual(["t3", "t1", "t2"]);
  });

  it("moves a tab between panes and collapses an empty source", () => {
    useEditorLayout.getState().ensureLayout(WS);
    const first = paneOfRoot();
    useEditorLayout.getState().setLayout(WS, {
      schemaVersion: 1,
      root: { ...first, tabs: [tab("t1")], activeTabId: "t1" },
      activePaneId: first.id,
    });
    const right = useEditorLayout.getState().splitPane(WS, first.id, "horizontal", "after");
    if (!right) throw new Error("split failed");
    useEditorLayout.getState().moveTab(WS, first.id, "t1", right, null);
    // After the move, source pane is empty so the split collapses to the right pane.
    const layout = useEditorLayout.getState().getLayout(WS);
    expect(layout.root.type).toBe("pane");
    expect((layout.root as PaneNode).tabs.map((t) => t.id)).toEqual(["t1"]);
  });

  it("keeps the source pane when it still has tabs after the move", () => {
    useEditorLayout.getState().ensureLayout(WS);
    const first = paneOfRoot();
    useEditorLayout.getState().setLayout(WS, {
      schemaVersion: 1,
      root: { ...first, tabs: [tab("t1"), tab("t2")], activeTabId: "t1" },
      activePaneId: first.id,
    });
    const right = useEditorLayout.getState().splitPane(WS, first.id, "horizontal", "after");
    if (!right) throw new Error("split failed");
    expect(useEditorLayout.getState().moveTab(WS, first.id, "t1", right, null)).toBe(true);
    const root = useEditorLayout.getState().getLayout(WS).root as SplitNode;
    expect(root.type).toBe("split");
    const src = root.children.find((c) => c.id === first.id) as PaneNode | undefined;
    expect(src?.tabs.map((t) => t.id)).toEqual(["t2"]);
  });
});

describe("useEditorLayout — splitWithTab", () => {
  it("returns null when nothing can be resolved", () => {
    expect(
      useEditorLayout.getState().splitWithTab("missing", "p", "t", "p2", "horizontal", "after"),
    ).toBeNull();
    useEditorLayout.getState().ensureLayout(WS);
    const first = paneOfRoot();
    expect(
      useEditorLayout
        .getState()
        .splitWithTab(WS, first.id, "missing-tab", first.id, "horizontal", "after"),
    ).toBeNull();
  });

  it("returns null when the source is the only tab in the only pane", () => {
    useEditorLayout.getState().ensureLayout(WS);
    const first = paneOfRoot();
    useEditorLayout.getState().setLayout(WS, {
      schemaVersion: 1,
      root: { ...first, tabs: [tab("t1")], activeTabId: "t1" },
      activePaneId: first.id,
    });
    expect(
      useEditorLayout.getState().splitWithTab(WS, first.id, "t1", first.id, "horizontal", "after"),
    ).toBeNull();
  });

  it("splits and moves the tab in one operation", () => {
    useEditorLayout.getState().ensureLayout(WS);
    const first = paneOfRoot();
    useEditorLayout.getState().setLayout(WS, {
      schemaVersion: 1,
      root: { ...first, tabs: [tab("t1"), tab("t2")], activeTabId: "t1" },
      activePaneId: first.id,
    });
    const newPane = useEditorLayout
      .getState()
      .splitWithTab(WS, first.id, "t1", first.id, "horizontal", "after");
    expect(newPane).not.toBeNull();
    const layout = useEditorLayout.getState().getLayout(WS);
    expect(layout.activePaneId).toBe(newPane);
  });
});

describe("useEditorLayout — tab state mutators", () => {
  function seed(tabs: PaneTab[]): { paneId: string } {
    useEditorLayout.getState().ensureLayout(WS);
    const first = paneOfRoot();
    useEditorLayout.getState().setLayout(WS, {
      schemaVersion: 1,
      root: { ...first, tabs, activeTabId: tabs[0]?.id ?? null },
      activePaneId: first.id,
    });
    return { paneId: first.id };
  }

  it("setTabPosition updates a tab's position", () => {
    const { paneId } = seed([tab("t1")]);
    useEditorLayout.getState().setTabPosition(WS, paneId, "t1", {
      line: 7,
      column: 3,
      scrollTop: 99,
    });
    const root = useEditorLayout.getState().getLayout(WS).root as PaneNode;
    expect(root.tabs[0]?.position).toEqual({ line: 7, column: 3, scrollTop: 99 });
  });

  it("setTabPosition is a no-op when the new position matches the old one", () => {
    const { paneId } = seed([tab("t1")]);
    const before = useEditorLayout.getState().getLayout(WS).root;
    useEditorLayout
      .getState()
      .setTabPosition(WS, paneId, "t1", { line: 0, column: 0, scrollTop: 0 });
    // Reference equality survives because nothing changed.
    expect(useEditorLayout.getState().getLayout(WS).root).toBe(before);
  });

  it("setTabPosition is a no-op when workspace / pane / tab is missing", () => {
    useEditorLayout.getState().setTabPosition("missing", "p", "t", {
      line: 1,
      column: 1,
      scrollTop: 0,
    });
    const { paneId } = seed([tab("t1")]);
    useEditorLayout.getState().setTabPosition(WS, "no-pane", "t1", {
      line: 1,
      column: 1,
      scrollTop: 0,
    });
    useEditorLayout.getState().setTabPosition(WS, paneId, "no-tab", {
      line: 1,
      column: 1,
      scrollTop: 0,
    });
  });

  it("setActiveTab switches the active tab and pane", () => {
    const { paneId } = seed([tab("t1"), tab("t2")]);
    useEditorLayout.getState().setActiveTab(WS, paneId, "t2");
    const layout = useEditorLayout.getState().getLayout(WS);
    expect((layout.root as PaneNode).activeTabId).toBe("t2");
    expect(layout.activePaneId).toBe(paneId);
  });

  it("setActiveTab is a no-op when the tab isn't in the pane or already active", () => {
    const { paneId } = seed([tab("t1")]);
    const before = useEditorLayout.getState().getLayout(WS).root;
    useEditorLayout.getState().setActiveTab(WS, paneId, "t1"); // already active
    expect(useEditorLayout.getState().getLayout(WS).root).toBe(before);
    useEditorLayout.getState().setActiveTab(WS, paneId, "no-tab"); // not present
    expect(useEditorLayout.getState().getLayout(WS).root).toBe(before);
    useEditorLayout.getState().setActiveTab("missing", paneId, "t1");
  });

  it("setActivePane switches the active pane id", () => {
    useEditorLayout.getState().ensureLayout(WS);
    const first = paneOfRoot();
    const right = useEditorLayout.getState().splitPane(WS, first.id, "horizontal", "after");
    if (!right) throw new Error("split failed");
    useEditorLayout.getState().setActivePane(WS, first.id);
    expect(useEditorLayout.getState().getLayout(WS).activePaneId).toBe(first.id);
  });

  it("setActivePane is a no-op when the pane is missing or already active", () => {
    useEditorLayout.getState().ensureLayout(WS);
    const first = paneOfRoot();
    useEditorLayout.getState().setActivePane(WS, first.id); // already active
    useEditorLayout.getState().setActivePane(WS, "no-such");
    useEditorLayout.getState().setActivePane("missing", "p");
  });

  it("closeTab removes a tab and activates a neighbour", () => {
    const { paneId } = seed([tab("t1"), tab("t2"), tab("t3")]);
    useEditorLayout.getState().setActiveTab(WS, paneId, "t2");
    useEditorLayout.getState().closeTab(WS, paneId, "t2");
    const root = useEditorLayout.getState().getLayout(WS).root as PaneNode;
    expect(root.tabs.map((t) => t.id)).toEqual(["t1", "t3"]);
    expect(root.activeTabId).toBe("t3");
  });

  it("closeTab falls back to the previous neighbour when closing the tail", () => {
    const { paneId } = seed([tab("t1"), tab("t2")]);
    useEditorLayout.getState().setActiveTab(WS, paneId, "t2");
    useEditorLayout.getState().closeTab(WS, paneId, "t2");
    const root = useEditorLayout.getState().getLayout(WS).root as PaneNode;
    expect(root.activeTabId).toBe("t1");
  });

  it("closeTab leaves activeTabId untouched when closing a non-active tab", () => {
    const { paneId } = seed([tab("t1"), tab("t2")]);
    useEditorLayout.getState().closeTab(WS, paneId, "t2");
    const root = useEditorLayout.getState().getLayout(WS).root as PaneNode;
    expect(root.activeTabId).toBe("t1");
  });

  it("closeTab leaves activeTabId null when removing the last tab", () => {
    const { paneId } = seed([tab("t1")]);
    useEditorLayout.getState().closeTab(WS, paneId, "t1");
    const root = useEditorLayout.getState().getLayout(WS).root as PaneNode;
    expect(root.activeTabId).toBeNull();
    expect(root.tabs).toEqual([]);
  });

  it("closeTab is a no-op when the tab or pane can't be resolved", () => {
    const { paneId } = seed([tab("t1")]);
    const before = useEditorLayout.getState().getLayout(WS).root;
    useEditorLayout.getState().closeTab(WS, paneId, "no-tab");
    expect(useEditorLayout.getState().getLayout(WS).root).toBe(before);
    useEditorLayout.getState().closeTab(WS, "no-pane", "t1");
    useEditorLayout.getState().closeTab("missing", paneId, "t1");
  });

  it("setTabPinned toggles a tab's pinned flag", () => {
    const { paneId } = seed([tab("t1")]);
    useEditorLayout.getState().setTabPinned(WS, paneId, "t1", true);
    const root = useEditorLayout.getState().getLayout(WS).root as PaneNode;
    expect(root.tabs[0]?.pinned).toBe(true);
  });

  it("setTabPinned is a no-op when the flag already matches", () => {
    const { paneId } = seed([tab("t1")]);
    useEditorLayout.getState().setTabPinned(WS, paneId, "t1", false);
    const before = useEditorLayout.getState().getLayout(WS).root;
    useEditorLayout.getState().setTabPinned(WS, paneId, "t1", false);
    expect(useEditorLayout.getState().getLayout(WS).root).toBe(before);
  });

  it("setTabPinned is a no-op for missing workspace / pane / tab", () => {
    useEditorLayout.getState().setTabPinned("missing", "p", "t", true);
    const { paneId } = seed([tab("t1")]);
    useEditorLayout.getState().setTabPinned(WS, "no-pane", "t1", true);
    useEditorLayout.getState().setTabPinned(WS, paneId, "no-tab", true);
  });
});

describe("useEditorLayout — setOrphaned", () => {
  function seedSplit(): { leftId: string; rightId: string } {
    useEditorLayout.getState().ensureLayout(WS);
    const first = useEditorLayout.getState().getLayout(WS).root as PaneNode;
    useEditorLayout.getState().setLayout(WS, {
      schemaVersion: 1,
      root: {
        ...first,
        tabs: [
          tab("t1", "/ws/a.md"),
          tab("t2", "/ws/dir/b.md"),
          tab("t3", "/ws/dir/sub/c.md"),
        ],
        activeTabId: "t1",
      },
      activePaneId: first.id,
    });
    const rightId = useEditorLayout.getState().splitPane(WS, first.id, "horizontal", "after");
    if (!rightId) throw new Error("split failed");
    // Drop a duplicate of /ws/dir/b.md into the right pane to cover the
    // "same path in multiple panes" case — external delete must mark both.
    const layout = useEditorLayout.getState().getLayout(WS);
    const split = layout.root as SplitNode;
    const right = split.children.find((c) => c.id === rightId) as PaneNode;
    useEditorLayout.getState().setLayout(WS, {
      ...layout,
      root: {
        ...split,
        children: split.children.map((c) =>
          c.id === rightId
            ? { ...right, tabs: [tab("t4", "/ws/dir/b.md")], activeTabId: "t4" }
            : c,
        ),
      },
    });
    return { leftId: first.id, rightId };
  }

  function tabsByPath(): Record<string, boolean | undefined> {
    const layout = useEditorLayout.getState().getLayout(WS);
    const out: Record<string, boolean | undefined> = {};
    const visit = (n: PaneNode | SplitNode) => {
      if (n.type === "pane") {
        for (const t of n.tabs) out[`${n.id}:${t.path}`] = t.orphaned;
        return;
      }
      for (const c of n.children) visit(c as PaneNode | SplitNode);
    };
    visit(layout.root as PaneNode | SplitNode);
    return out;
  }

  it("marks an exact-path tab orphaned across all panes", () => {
    seedSplit();
    useEditorLayout.getState().setOrphaned(WS, "/ws/a.md", true);
    const flags = tabsByPath();
    // /ws/a.md lives only in the left pane.
    const aEntry = Object.entries(flags).find(([k]) => k.endsWith(":/ws/a.md"));
    expect(aEntry?.[1]).toBe(true);
    // Other tabs untouched.
    const others = Object.entries(flags)
      .filter(([k]) => !k.endsWith(":/ws/a.md"))
      .map(([, v]) => v ?? false);
    expect(others.every((v) => v === false)).toBe(true);
  });

  it("marks descendants of a deleted folder orphaned in every pane", () => {
    seedSplit();
    useEditorLayout.getState().setOrphaned(WS, "/ws/dir", true);
    const flags = tabsByPath();
    // /ws/dir/b.md exists in both panes; /ws/dir/sub/c.md exists once.
    const flagged = Object.entries(flags).filter(([k]) =>
      k.includes(":/ws/dir/b.md") || k.includes(":/ws/dir/sub/c.md"),
    );
    expect(flagged).toHaveLength(3);
    for (const [, v] of flagged) expect(v).toBe(true);
    // /ws/a.md (sibling, not under /ws/dir) is untouched.
    const aEntry = Object.entries(flags).find(([k]) => k.endsWith(":/ws/a.md"));
    expect(aEntry?.[1] ?? false).toBe(false);
  });

  it("clears the orphan flag when called with orphaned=false", () => {
    seedSplit();
    useEditorLayout.getState().setOrphaned(WS, "/ws/dir", true);
    useEditorLayout.getState().setOrphaned(WS, "/ws/dir/b.md", false);
    const flags = tabsByPath();
    // b.md cleared in both panes, c.md still flagged.
    const bEntries = Object.entries(flags).filter(([k]) => k.endsWith(":/ws/dir/b.md"));
    expect(bEntries.every(([, v]) => v === false)).toBe(true);
    const cEntry = Object.entries(flags).find(([k]) => k.endsWith(":/ws/dir/sub/c.md"));
    expect(cEntry?.[1]).toBe(true);
  });

  it("is a no-op when nothing matches (preserves root identity)", () => {
    seedSplit();
    const before = useEditorLayout.getState().getLayout(WS).root;
    useEditorLayout.getState().setOrphaned(WS, "/ws/nothing", true);
    expect(useEditorLayout.getState().getLayout(WS).root).toBe(before);
  });

  it("is a no-op when the flag already matches", () => {
    seedSplit();
    // Default is undefined (falsy); calling with false is a no-op for every tab.
    const before = useEditorLayout.getState().getLayout(WS).root;
    useEditorLayout.getState().setOrphaned(WS, "/ws/a.md", false);
    expect(useEditorLayout.getState().getLayout(WS).root).toBe(before);
  });

  it("is a no-op when the workspace is missing", () => {
    useEditorLayout.getState().setOrphaned("missing", "/ws/a.md", true);
    expect(useEditorLayout.getState().layouts["missing"]).toBeUndefined();
  });

  it("matches Windows-style descendant paths (backslash separator)", () => {
    useEditorLayout.getState().ensureLayout(WS);
    const first = useEditorLayout.getState().getLayout(WS).root as PaneNode;
    useEditorLayout.getState().setLayout(WS, {
      schemaVersion: 1,
      root: { ...first, tabs: [tab("t1", "C:\\ws\\dir\\b.md")], activeTabId: "t1" },
      activePaneId: first.id,
    });
    useEditorLayout.getState().setOrphaned(WS, "C:\\ws\\dir", true);
    const root = useEditorLayout.getState().getLayout(WS).root as PaneNode;
    expect(root.tabs[0]?.orphaned).toBe(true);
  });
});

describe("useEditorLayout — persistence", () => {
  it("only the layouts slice is exposed for persistence", () => {
    useEditorLayout.getState().ensureLayout(WS);
    const state = useEditorLayout.getState();
    const slice = { layouts: state.layouts };
    expect(Object.keys(slice)).toEqual(["layouts"]);
  });
});
