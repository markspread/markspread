// S-MWS-001: workspace-layout store mutations + serialize/deserialize round-trip.

import { beforeEach, describe, expect, it } from "vitest";
import {
  type WindowLayout,
  type WorkspaceSplitNode,
  type WorkspaceTabsNode,
  createTabsNode,
  createWorkspaceTab,
  defaultTabState,
  deserializeWindowLayout,
  emptyWindowLayout,
  findTab,
  findTabsNode,
  forEachTabsNode,
  serializeWindowLayout,
  useWorkspaceLayout,
  workspaceIdFor,
} from "./workspace-layout";

beforeEach(() => {
  useWorkspaceLayout.setState({ layout: null });
});

function getLayout(): WindowLayout {
  const layout = useWorkspaceLayout.getState().layout;
  if (!layout) throw new Error("expected layout");
  return layout;
}

describe("workspaceIdFor", () => {
  it("hashes paths deterministically", () => {
    expect(workspaceIdFor("/a")).toBe(workspaceIdFor("/a"));
    expect(workspaceIdFor("/a")).not.toBe(workspaceIdFor("/b"));
  });
});

describe("createWorkspaceTab / createTabsNode / emptyWindowLayout", () => {
  it("defaults id, workspaceId, tabState", () => {
    const tab = createWorkspaceTab("/ws");
    expect(tab.id).toMatch(/^wstab-/);
    expect(tab.workspaceId).toBe(workspaceIdFor("/ws"));
    expect(tab.tabState.sidebarCollapsed).toBe(false);
    expect(tab.tabState.fileTreeSortMode).toBe("name");
  });

  it("createWorkspaceTab honours partial overrides", () => {
    const tab = createWorkspaceTab("/ws", {
      id: "fixed",
      workspaceId: "wid",
      tabState: defaultTabState({ sidebarCollapsed: true }),
    });
    expect(tab.id).toBe("fixed");
    expect(tab.workspaceId).toBe("wid");
    expect(tab.tabState.sidebarCollapsed).toBe(true);
  });

  it("createTabsNode picks the first tab as active when omitted", () => {
    const t1 = createWorkspaceTab("/a");
    const t2 = createWorkspaceTab("/b");
    const node = createTabsNode([t1, t2]);
    expect(node.activeTabId).toBe(t1.id);
    const explicit = createTabsNode([t1, t2], t2.id);
    expect(explicit.activeTabId).toBe(t2.id);
  });

  it("createTabsNode rejects empty input", () => {
    expect(() => createTabsNode([])).toThrowError(/at least one tab/);
  });

  it("emptyWindowLayout wraps a single-tab single-split tree", () => {
    const layout = emptyWindowLayout("/ws");
    expect(layout.root.type).toBe("ws-tabs");
    expect(layout.activeTabId).toBe((layout.root as WorkspaceTabsNode).tabs[0]?.id);
  });
});

describe("useWorkspaceLayout — ensure / setLayout", () => {
  it("ensure creates a fresh layout once, then returns the same instance", () => {
    const a = useWorkspaceLayout.getState().ensure("/ws");
    const b = useWorkspaceLayout.getState().ensure("/other");
    expect(a).toBe(b);
  });

  it("setLayout replaces the layout wholesale", () => {
    const layout = emptyWindowLayout("/ws");
    useWorkspaceLayout.getState().setLayout(layout);
    expect(useWorkspaceLayout.getState().layout).toBe(layout);
  });
});

describe("useWorkspaceLayout — addWorkspaceTab", () => {
  it("returns null when no layout exists", () => {
    expect(useWorkspaceLayout.getState().addWorkspaceTab("/x")).toBeNull();
  });

  it("appends to the active ws-tabs node and activates by default", () => {
    useWorkspaceLayout.getState().ensure("/ws");
    const newId = useWorkspaceLayout.getState().addWorkspaceTab("/other");
    expect(newId).not.toBeNull();
    const layout = getLayout();
    expect(layout.activeTabId).toBe(newId);
    const root = layout.root as WorkspaceTabsNode;
    expect(root.tabs).toHaveLength(2);
    expect(root.tabs[1]?.workspacePath).toBe("/other");
    expect(root.activeTabId).toBe(newId);
  });

  it("respects activate=false (does not move focus)", () => {
    useWorkspaceLayout.getState().ensure("/ws");
    const before = useWorkspaceLayout.getState().layout?.activeTabId;
    const newId = useWorkspaceLayout.getState().addWorkspaceTab("/bg", { activate: false });
    const after = useWorkspaceLayout.getState().layout?.activeTabId;
    expect(after).toBe(before);
    expect(newId).not.toBeNull();
  });

  it("returns null when targetNodeId does not resolve", () => {
    useWorkspaceLayout.getState().ensure("/ws");
    expect(
      useWorkspaceLayout.getState().addWorkspaceTab("/x", { targetNodeId: "nope" }),
    ).toBeNull();
  });

  it("returns null when neither opts.targetNodeId nor active tabs node can be found", () => {
    // 의도적으로 activeTabId 가 트리에 없는 상태를 만들어 fallback 미스를 유도.
    useWorkspaceLayout.getState().ensure("/ws");
    const layout = getLayout();
    useWorkspaceLayout.setState({ layout: { ...layout, activeTabId: "orphan" } });
    expect(useWorkspaceLayout.getState().addWorkspaceTab("/x")).toBeNull();
  });
});

describe("useWorkspaceLayout — splitVertical / splitHorizontal", () => {
  it("returns null when no layout exists", () => {
    expect(useWorkspaceLayout.getState().splitVertical()).toBeNull();
    expect(useWorkspaceLayout.getState().splitHorizontal()).toBeNull();
  });

  it("returns null for unknown tabId", () => {
    useWorkspaceLayout.getState().ensure("/ws");
    expect(useWorkspaceLayout.getState().splitVertical("nope")).toBeNull();
  });

  it("splits the root tabs node into a 2-way horizontal-direction split (vertical visual)", () => {
    useWorkspaceLayout.getState().ensure("/ws");
    const newId = useWorkspaceLayout.getState().splitVertical();
    expect(newId).not.toBeNull();
    const root = getLayout().root as WorkspaceSplitNode;
    expect(root.type).toBe("ws-split");
    expect(root.direction).toBe("horizontal");
    expect(root.children).toHaveLength(2);
    // 두 자식 모두 ws-tabs.
    for (const c of root.children) expect(c.type).toBe("ws-tabs");
    expect(getLayout().activeTabId).toBe(newId);
  });

  it("splitHorizontal produces a vertical-direction split", () => {
    useWorkspaceLayout.getState().ensure("/ws");
    useWorkspaceLayout.getState().splitHorizontal();
    const root = getLayout().root as WorkspaceSplitNode;
    expect(root.direction).toBe("vertical");
  });

  it("split keeps the source workspace path and creates a fresh tab id", () => {
    useWorkspaceLayout.getState().ensure("/ws");
    const sourceTabId = getLayout().activeTabId;
    const newId = useWorkspaceLayout.getState().splitVertical();
    expect(newId).not.toBe(sourceTabId);
    const located = findTab(getLayout().root, newId ?? "");
    expect(located?.tab.workspacePath).toBe("/ws");
  });
});

describe("useWorkspaceLayout — closeWorkspaceTab", () => {
  it("returns false when no layout exists", () => {
    expect(useWorkspaceLayout.getState().closeWorkspaceTab("none")).toBe(false);
  });

  it("returns false for unknown tabId", () => {
    useWorkspaceLayout.getState().ensure("/ws");
    expect(useWorkspaceLayout.getState().closeWorkspaceTab("nope")).toBe(false);
  });

  it("protects the last surviving tab (returns false)", () => {
    useWorkspaceLayout.getState().ensure("/ws");
    const onlyId = getLayout().activeTabId;
    expect(useWorkspaceLayout.getState().closeWorkspaceTab(onlyId)).toBe(false);
    expect(getLayout().activeTabId).toBe(onlyId);
  });

  it("closes a non-active tab, leaves activeTabId untouched when possible", () => {
    useWorkspaceLayout.getState().ensure("/ws");
    const newId = useWorkspaceLayout.getState().addWorkspaceTab("/other");
    const firstId =
      getLayout().activeTabId === newId
        ? // active is the new tab; pick the first of the node
          ((getLayout().root as WorkspaceTabsNode).tabs[0]?.id ?? "")
        : getLayout().activeTabId;
    // Make the first tab the active one so we close the *second*.
    useWorkspaceLayout.getState().setActiveTab(firstId);
    expect(useWorkspaceLayout.getState().closeWorkspaceTab(newId ?? "")).toBe(true);
    const root = getLayout().root as WorkspaceTabsNode;
    expect(root.tabs).toHaveLength(1);
    expect(getLayout().activeTabId).toBe(firstId);
  });

  it("closes the active tab and promotes the neighbour", () => {
    useWorkspaceLayout.getState().ensure("/ws");
    const second = useWorkspaceLayout.getState().addWorkspaceTab("/other");
    // active is now `second`; close it.
    expect(useWorkspaceLayout.getState().closeWorkspaceTab(second ?? "")).toBe(true);
    const root = getLayout().root as WorkspaceTabsNode;
    expect(root.tabs).toHaveLength(1);
    expect(root.activeTabId).toBe(root.tabs[0]?.id);
    expect(getLayout().activeTabId).toBe(root.tabs[0]?.id);
  });

  it("collapses an empty split branch via mergeIfTrivial", () => {
    useWorkspaceLayout.getState().ensure("/ws");
    const newPaneTab = useWorkspaceLayout.getState().splitVertical();
    expect(getLayout().root.type).toBe("ws-split");
    expect(useWorkspaceLayout.getState().closeWorkspaceTab(newPaneTab ?? "")).toBe(true);
    expect(getLayout().root.type).toBe("ws-tabs");
  });
});

describe("useWorkspaceLayout — setActiveTab", () => {
  it("noops when no layout / unknown tab", () => {
    useWorkspaceLayout.getState().setActiveTab("none");
    expect(useWorkspaceLayout.getState().layout).toBeNull();
    useWorkspaceLayout.getState().ensure("/ws");
    const before = useWorkspaceLayout.getState().layout;
    useWorkspaceLayout.getState().setActiveTab("nope");
    expect(useWorkspaceLayout.getState().layout).toBe(before);
  });

  it("activates a sibling tab and syncs the ws-tabs node's activeTabId", () => {
    useWorkspaceLayout.getState().ensure("/ws");
    const second = useWorkspaceLayout.getState().addWorkspaceTab("/other");
    const firstId = (getLayout().root as WorkspaceTabsNode).tabs[0]?.id ?? "";
    useWorkspaceLayout.getState().setActiveTab(firstId);
    expect(getLayout().activeTabId).toBe(firstId);
    expect((getLayout().root as WorkspaceTabsNode).activeTabId).toBe(firstId);
    // Same call is idempotent (no throw, no infinite loop).
    useWorkspaceLayout.getState().setActiveTab(firstId);
    expect(getLayout().activeTabId).toBe(firstId);
    // Activate the second again — exercises the "already-active node, different tab" branch.
    useWorkspaceLayout.getState().setActiveTab(second ?? "");
    expect(getLayout().activeTabId).toBe(second);
  });

  it("re-activating an already-active tab is a stable noop (covers res.changed=false arm)", () => {
    useWorkspaceLayout.getState().ensure("/ws");
    const id = getLayout().activeTabId;
    // Tweak activeTabId to mismatch ws-tabs node's activeTabId artificially.
    const layout = getLayout();
    useWorkspaceLayout.setState({ layout: { ...layout, activeTabId: id } });
    useWorkspaceLayout.getState().setActiveTab(id);
    expect(getLayout().activeTabId).toBe(id);
  });
});

describe("useWorkspaceLayout — moveTab", () => {
  it("returns false for unknown source/target", () => {
    expect(useWorkspaceLayout.getState().moveTab("nope", { nodeId: "nope", index: 0 })).toBe(false);
    useWorkspaceLayout.getState().ensure("/ws");
    expect(useWorkspaceLayout.getState().moveTab("nope", { nodeId: "nope", index: 0 })).toBe(false);
    // valid source, unknown target
    const tabId = getLayout().activeTabId;
    expect(useWorkspaceLayout.getState().moveTab(tabId, { nodeId: "nope", index: 0 })).toBe(false);
  });

  it("reorders within the same node and returns true", () => {
    useWorkspaceLayout.getState().ensure("/ws");
    useWorkspaceLayout.getState().addWorkspaceTab("/other");
    useWorkspaceLayout.getState().addWorkspaceTab("/third");
    const root = getLayout().root as WorkspaceTabsNode;
    const firstId = root.tabs[0]?.id ?? "";
    const moved = useWorkspaceLayout.getState().moveTab(firstId, { nodeId: root.id, index: 2 });
    expect(moved).toBe(true);
    const reordered = getLayout().root as WorkspaceTabsNode;
    expect(reordered.tabs[2]?.id).toBe(firstId);
  });

  it("returns false for same-position reorder", () => {
    useWorkspaceLayout.getState().ensure("/ws");
    useWorkspaceLayout.getState().addWorkspaceTab("/other");
    const root = getLayout().root as WorkspaceTabsNode;
    const lastId = root.tabs[root.tabs.length - 1]?.id ?? "";
    expect(useWorkspaceLayout.getState().moveTab(lastId, { nodeId: root.id, index: null })).toBe(
      false,
    );
  });

  it("moves a tab across nodes after a split", () => {
    useWorkspaceLayout.getState().ensure("/ws");
    const right = useWorkspaceLayout.getState().splitVertical();
    const rootSplit = getLayout().root as WorkspaceSplitNode;
    const leftNode = rootSplit.children[0] as WorkspaceTabsNode;
    const rightNode = rootSplit.children[1] as WorkspaceTabsNode;
    // Move the right tab back into the left node.
    const moved = useWorkspaceLayout
      .getState()
      .moveTab(right ?? "", { nodeId: leftNode.id, index: 0 });
    expect(moved).toBe(true);
    // Right node collapsed away, root merged.
    expect(getLayout().root.type).toBe("ws-tabs");
    expect((getLayout().root as WorkspaceTabsNode).tabs).toHaveLength(2);
    // setActive on dropped tab.
    expect(getLayout().activeTabId).toBe(right);
    // No-op variable read so biome doesn't complain.
    void rightNode;
  });

  it("cross-node move when source node retains tabs (no collapse)", () => {
    useWorkspaceLayout.getState().ensure("/ws");
    // Add a second tab to the source so it does not collapse.
    useWorkspaceLayout.getState().addWorkspaceTab("/companion");
    const sourceNode = getLayout().root as WorkspaceTabsNode;
    const leftId = sourceNode.tabs[0]?.id ?? "";
    // Split to create a target node.
    useWorkspaceLayout.getState().splitVertical();
    const split = getLayout().root as WorkspaceSplitNode;
    const targetNode = split.children[1] as WorkspaceTabsNode;
    expect(
      useWorkspaceLayout.getState().moveTab(leftId, { nodeId: targetNode.id, index: null }),
    ).toBe(true);
    const splitAfter = getLayout().root as WorkspaceSplitNode;
    expect(splitAfter.type).toBe("ws-split");
    const tgtAfter = splitAfter.children[1] as WorkspaceTabsNode;
    expect(tgtAfter.tabs.some((t) => t.id === leftId)).toBe(true);
  });

  it("moves the active tab and updates source node's activeTabId", () => {
    useWorkspaceLayout.getState().ensure("/ws");
    useWorkspaceLayout.getState().addWorkspaceTab("/other");
    const sourceNode = getLayout().root as WorkspaceTabsNode;
    const activeId = sourceNode.activeTabId;
    useWorkspaceLayout.getState().splitVertical();
    const split = getLayout().root as WorkspaceSplitNode;
    const leftNode = split.children[0] as WorkspaceTabsNode;
    const targetNode = split.children[1] as WorkspaceTabsNode;
    // active currently sits in the right (clone) — move the left's active out.
    useWorkspaceLayout.getState().setActiveTab(leftNode.activeTabId);
    const moved = useWorkspaceLayout
      .getState()
      .moveTab(activeId, { nodeId: targetNode.id, index: null });
    expect(moved).toBe(true);
    // Source node should have re-elected an active tab from its remaining set.
    const leftAfter = (getLayout().root as WorkspaceSplitNode).children[0] as WorkspaceTabsNode;
    expect(leftAfter.tabs.length).toBeGreaterThan(0);
    expect(leftAfter.activeTabId).not.toBe(activeId);
  });
});

describe("useWorkspaceLayout — patchTabState", () => {
  it("noops on missing layout / unknown tab", () => {
    useWorkspaceLayout.getState().patchTabState("none", { sidebarCollapsed: true });
    expect(useWorkspaceLayout.getState().layout).toBeNull();
    useWorkspaceLayout.getState().ensure("/ws");
    const before = useWorkspaceLayout.getState().layout;
    useWorkspaceLayout.getState().patchTabState("nope", { sidebarCollapsed: true });
    expect(useWorkspaceLayout.getState().layout).toBe(before);
  });

  it("merges patch into the target tab's tabState, leaving siblings untouched", () => {
    useWorkspaceLayout.getState().ensure("/ws");
    useWorkspaceLayout.getState().addWorkspaceTab("/other");
    const root = getLayout().root as WorkspaceTabsNode;
    const id = root.tabs[0]?.id ?? "";
    const otherId = root.tabs[1]?.id ?? "";
    useWorkspaceLayout.getState().patchTabState(id, {
      sidebarCollapsed: true,
      fileTreeExpanded: ["/ws/a"],
      fileTreeSearchQuery: "todo",
    });
    const tab = findTab(getLayout().root, id)?.tab;
    const sibling = findTab(getLayout().root, otherId)?.tab;
    expect(tab?.tabState.sidebarCollapsed).toBe(true);
    expect(tab?.tabState.fileTreeExpanded).toEqual(["/ws/a"]);
    expect(tab?.tabState.fileTreeSearchQuery).toBe("todo");
    expect(sibling?.tabState.sidebarCollapsed).toBe(false);
  });
});

describe("useWorkspaceLayout — mergeIfTrivial", () => {
  it("is a noop with no layout", () => {
    useWorkspaceLayout.getState().mergeIfTrivial();
    expect(useWorkspaceLayout.getState().layout).toBeNull();
  });

  it("is a noop when the tree has no 1-child splits", () => {
    useWorkspaceLayout.getState().ensure("/ws");
    const before = useWorkspaceLayout.getState().layout;
    useWorkspaceLayout.getState().mergeIfTrivial();
    expect(useWorkspaceLayout.getState().layout).toBe(before);
  });

  it("collapses a hand-crafted 1-child split", () => {
    const leaf = createTabsNode([createWorkspaceTab("/ws")]);
    const wrappingSplit: WorkspaceSplitNode = {
      type: "ws-split",
      id: "s1",
      direction: "horizontal",
      children: [leaf],
      sizes: [1],
    };
    useWorkspaceLayout.setState({
      layout: {
        schemaVersion: 2,
        root: wrappingSplit,
        activeTabId: leaf.tabs[0]?.id ?? "",
      },
    });
    useWorkspaceLayout.getState().mergeIfTrivial();
    expect(useWorkspaceLayout.getState().layout?.root.type).toBe("ws-tabs");
  });
});

describe("useWorkspaceLayout — serialize / deserialize round-trip", () => {
  it("round-trips a single-tab layout", () => {
    useWorkspaceLayout.getState().ensure("/ws");
    const dumped = useWorkspaceLayout.getState().serialize();
    useWorkspaceLayout.setState({ layout: null });
    expect(useWorkspaceLayout.getState().deserialize(dumped)).toBe(true);
    expect(getLayout().activeTabId).toBeTruthy();
  });

  it("store.deserialize returns false on malformed input", () => {
    expect(useWorkspaceLayout.getState().deserialize({ schemaVersion: 99 })).toBe(false);
  });

  it("round-trips a split layout with multiple tabs and patched state", () => {
    useWorkspaceLayout.getState().ensure("/ws");
    useWorkspaceLayout.getState().addWorkspaceTab("/notes");
    const cloneId = useWorkspaceLayout.getState().splitVertical();
    useWorkspaceLayout.getState().patchTabState(cloneId ?? "", {
      sidebarCollapsed: true,
      sidebarWidth: 320,
      pinned: true,
      fileTreeExpanded: ["/notes/a", "/notes/b"],
      fileTreeSortMode: "modified",
    });
    const dumped = JSON.parse(JSON.stringify(serializeWindowLayout(getLayout())));
    const parsed = deserializeWindowLayout(dumped);
    expect(parsed).not.toBeNull();
    if (!parsed) return;
    expect(parsed.root.type).toBe("ws-split");
    const restoredTab = findTab(parsed.root, cloneId ?? "")?.tab;
    expect(restoredTab?.tabState.sidebarCollapsed).toBe(true);
    expect(restoredTab?.tabState.sidebarWidth).toBe(320);
    expect(restoredTab?.tabState.pinned).toBe(true);
    expect(restoredTab?.tabState.fileTreeExpanded).toEqual(["/notes/a", "/notes/b"]);
    expect(restoredTab?.tabState.fileTreeSortMode).toBe("modified");
  });

  it("deserialize rejects malformed input", () => {
    expect(deserializeWindowLayout(null)).toBeNull();
    expect(deserializeWindowLayout("nope")).toBeNull();
    expect(deserializeWindowLayout({ schemaVersion: 1 })).toBeNull();
    expect(deserializeWindowLayout({ schemaVersion: 2, root: null })).toBeNull();
    // bogus root type
    expect(
      deserializeWindowLayout({ schemaVersion: 2, root: { type: "bad", id: "x" } }),
    ).toBeNull();
    // tabs-node with no tabs
    expect(
      deserializeWindowLayout({
        schemaVersion: 2,
        root: { type: "ws-tabs", id: "n", tabs: [] },
      }),
    ).toBeNull();
    // split-node with no children
    expect(
      deserializeWindowLayout({
        schemaVersion: 2,
        root: { type: "ws-split", id: "s", direction: "horizontal", children: [] },
      }),
    ).toBeNull();
    // split-node with bad direction
    expect(
      deserializeWindowLayout({
        schemaVersion: 2,
        root: { type: "ws-split", id: "s", direction: "diag", children: [{}] },
      }),
    ).toBeNull();
    // tabs-node id missing
    expect(
      deserializeWindowLayout({
        schemaVersion: 2,
        root: { type: "ws-tabs", tabs: [{ id: "t", workspacePath: "/x" }] },
      }),
    ).toBeNull();
    // split-node id missing
    expect(
      deserializeWindowLayout({
        schemaVersion: 2,
        root: { type: "ws-split", direction: "horizontal", children: [] },
      }),
    ).toBeNull();
    // bad tabs.children (not array)
    expect(
      deserializeWindowLayout({
        schemaVersion: 2,
        root: { type: "ws-split", id: "s", direction: "horizontal", children: "nope" },
      }),
    ).toBeNull();
    // tab without id or path
    expect(
      deserializeWindowLayout({
        schemaVersion: 2,
        root: { type: "ws-tabs", id: "n", tabs: [{ workspacePath: "/x" }] },
      }),
    ).toBeNull();
  });

  it("deserialize drops null/non-object tabs and split children silently", () => {
    const restored = deserializeWindowLayout({
      schemaVersion: 2,
      activeTabId: "t1",
      root: {
        type: "ws-split",
        id: "s",
        direction: "horizontal",
        children: [
          null,
          "not-a-node",
          { type: "ws-tabs", id: "n", tabs: [null, "bad", { id: "t1", workspacePath: "/a" }] },
        ],
      },
    });
    const split = restored?.root as WorkspaceSplitNode;
    expect(split.type).toBe("ws-split");
    // Only the single valid child survives, which causes mergeIfTrivial-via-loader
    // — but parseSplitNode does not merge, so we still see a 1-child split here.
    expect(split.children).toHaveLength(1);
    const onlyChild = split.children[0] as WorkspaceTabsNode;
    expect(onlyChild.tabs).toHaveLength(1);
  });

  it("deserialize falls back to default expansion when fileTreeExpanded is not an array", () => {
    const restored = deserializeWindowLayout({
      schemaVersion: 2,
      activeTabId: "t1",
      root: {
        type: "ws-tabs",
        id: "n",
        activeTabId: "t1",
        tabs: [
          {
            id: "t1",
            workspacePath: "/ws",
            tabState: { fileTreeExpanded: "not-an-array" },
          },
        ],
      },
    });
    const tab = findTab(restored?.root ?? ({} as never), "t1")?.tab;
    expect(tab?.tabState.fileTreeExpanded).toEqual([]);
  });

  it("deserialize fills tabState defaults when missing or partial", () => {
    const restored = deserializeWindowLayout({
      schemaVersion: 2,
      activeTabId: "t1",
      root: {
        type: "ws-tabs",
        id: "n1",
        activeTabId: "t1",
        tabs: [
          {
            id: "t1",
            workspaceId: "wid",
            workspacePath: "/ws",
            tabState: {
              sidebarCollapsed: "nope",
              fileTreeExpanded: ["/ws", 42, "/ws/x"],
              fileTreeScrollTop: "bad",
              fileTreeSortMode: "garbage",
              readOnly: "no",
              lastVisitedAt: "x",
              fileTreeSearchQuery: 9,
            },
          },
          { id: "t2", workspacePath: "/other" },
        ],
      },
    });
    expect(restored).not.toBeNull();
    if (!restored) return;
    const tab = findTab(restored.root, "t1")?.tab;
    expect(tab?.tabState.sidebarCollapsed).toBe(false);
    expect(tab?.tabState.fileTreeExpanded).toEqual(["/ws", "/ws/x"]);
    expect(tab?.tabState.fileTreeScrollTop).toBe(0);
    expect(tab?.tabState.fileTreeSortMode).toBe("name");
    expect(tab?.tabState.readOnly).toBe(false);
    expect(tab?.tabState.fileTreeSearchQuery).toBe("");
    // fully-missing tabState falls back to defaults.
    const t2 = findTab(restored.root, "t2")?.tab;
    expect(t2?.tabState.fileTreeSortMode).toBe("name");
    expect(t2?.workspaceId).toBe(workspaceIdFor("/other"));
  });

  it("deserialize repairs activeTabId mismatch by promoting the first tab", () => {
    const restored = deserializeWindowLayout({
      schemaVersion: 2,
      activeTabId: "missing",
      root: {
        type: "ws-tabs",
        id: "n1",
        activeTabId: "missing",
        tabs: [{ id: "t1", workspacePath: "/ws" }],
      },
    });
    expect(restored?.activeTabId).toBe("t1");
  });

  it("deserialize accepts split with mismatched sizes by normalising", () => {
    const restored = deserializeWindowLayout({
      schemaVersion: 2,
      activeTabId: "t1",
      root: {
        type: "ws-split",
        id: "s",
        direction: "horizontal",
        sizes: [1, 2, 3], // wrong length vs children
        children: [
          { type: "ws-tabs", id: "n1", tabs: [{ id: "t1", workspacePath: "/a" }] },
          { type: "ws-tabs", id: "n2", tabs: [{ id: "t2", workspacePath: "/b" }] },
        ],
      },
    });
    const split = restored?.root as WorkspaceSplitNode;
    expect(split.sizes).toHaveLength(2);
    expect(split.sizes.reduce((a, b) => a + b, 0)).toBeCloseTo(1);
  });

  it("deserialize honours per-element NaN sanitisation in sizes", () => {
    const restored = deserializeWindowLayout({
      schemaVersion: 2,
      activeTabId: "t1",
      root: {
        type: "ws-split",
        id: "s",
        direction: "vertical",
        sizes: [Number.NaN, "x"],
        children: [
          { type: "ws-tabs", id: "n1", tabs: [{ id: "t1", workspacePath: "/a" }] },
          { type: "ws-tabs", id: "n2", tabs: [{ id: "t2", workspacePath: "/b" }] },
        ],
      },
    });
    const split = restored?.root as WorkspaceSplitNode;
    expect(split.sizes).toEqual([0.5, 0.5]);
  });
});

describe("traversal helpers", () => {
  it("forEachTabsNode visits every leaf", () => {
    useWorkspaceLayout.getState().ensure("/ws");
    useWorkspaceLayout.getState().splitVertical();
    let count = 0;
    forEachTabsNode(getLayout().root, () => {
      count += 1;
    });
    expect(count).toBe(2);
  });

  it("forEachTabsNode short-circuits when the visitor returns false", () => {
    useWorkspaceLayout.getState().ensure("/ws");
    useWorkspaceLayout.getState().splitVertical();
    let count = 0;
    forEachTabsNode(getLayout().root, () => {
      count += 1;
      return false;
    });
    expect(count).toBe(1);
  });

  it("findTab returns null for unknown id and located result otherwise", () => {
    useWorkspaceLayout.getState().ensure("/ws");
    const id = getLayout().activeTabId;
    expect(findTab(getLayout().root, "missing")).toBeNull();
    expect(findTab(getLayout().root, id)?.tab.id).toBe(id);
  });

  it("findTabsNode locates a leaf or returns null", () => {
    useWorkspaceLayout.getState().ensure("/ws");
    const nodeId = (getLayout().root as WorkspaceTabsNode).id;
    expect(findTabsNode(getLayout().root, nodeId)?.id).toBe(nodeId);
    expect(findTabsNode(getLayout().root, "nope")).toBeNull();
  });
});

describe("serializeWindowLayout", () => {
  it("emits the canonical shape", () => {
    useWorkspaceLayout.getState().ensure("/ws");
    const out = serializeWindowLayout(getLayout()) as Record<string, unknown>;
    expect(out.schemaVersion).toBe(2);
    expect(out.activeTabId).toBe(getLayout().activeTabId);
    expect(out.root).toBe(getLayout().root);
  });
});
