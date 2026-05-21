// S-ESP-011: split/focus/close commands wrapping the editor-layout store.

import { beforeEach, describe, expect, it } from "vitest";
import {
  closeActiveTabCommand,
  focusPaneCommand,
  moveEditorToNextGroupCommand,
  splitDownCommand,
  splitRightCommand,
} from "../lib/commands/editor-layout";
import { type SplitNode, findPane, forEachPane } from "../lib/editor/layout-model";
import { useEditorLayout } from "../store/editor-layout";
import { useTabs } from "../store/tabs";
import { useWorkspace } from "../store/workspace";

const WS = "/tmp/cmd-ws";

const POS = { line: 0, column: 0, scrollTop: 0 };

beforeEach(() => {
  useEditorLayout.setState({ layouts: {} });
  useWorkspace.setState({ current: null, readOnly: false });
  useTabs.setState({ tabs: [], activePath: null });
});

describe("editor-layout commands", () => {
  it("splitRight no-ops without a workspace", () => {
    splitRightCommand();
    expect(useEditorLayout.getState().layouts).toEqual({});
  });

  it("splitRight creates a horizontal split after the active pane", () => {
    useWorkspace.setState({ current: WS, readOnly: false });
    const initial = useEditorLayout.getState().ensureLayout(WS);
    splitRightCommand();
    const root = useEditorLayout.getState().layouts[WS]?.root as SplitNode;
    expect(root.type).toBe("split");
    expect(root.direction).toBe("horizontal");
    expect(root.children).toHaveLength(2);
    // First child stays the original pane; new pane becomes active.
    expect(root.children[0]?.id).toBe(initial.root.id);
    expect(useEditorLayout.getState().layouts[WS]?.activePaneId).toBe(root.children[1]?.id);
  });

  it("splitDown creates a vertical split", () => {
    useWorkspace.setState({ current: WS, readOnly: false });
    useEditorLayout.getState().ensureLayout(WS);
    splitDownCommand();
    const root = useEditorLayout.getState().layouts[WS]?.root as SplitNode;
    expect(root.type).toBe("split");
    expect(root.direction).toBe("vertical");
  });

  it("focusPane(n) selects the n-th pane in DFS order", () => {
    useWorkspace.setState({ current: WS, readOnly: false });
    const initial = useEditorLayout.getState().ensureLayout(WS);
    splitRightCommand(); // 2 panes
    splitRightCommand(); // 3 panes (flat horizontal split)
    const order: string[] = [];
    // biome-ignore lint/style/noNonNullAssertion: ensureLayout(WS) above guarantees the layout exists.
    forEachPane(useEditorLayout.getState().layouts[WS]!.root, (p) => {
      order.push(p.id);
    });
    expect(order).toHaveLength(3);
    expect(order[0]).toBe(initial.root.id);

    focusPaneCommand(1);
    expect(useEditorLayout.getState().layouts[WS]?.activePaneId).toBe(order[0]);
    focusPaneCommand(2);
    expect(useEditorLayout.getState().layouts[WS]?.activePaneId).toBe(order[1]);
    focusPaneCommand(3);
    expect(useEditorLayout.getState().layouts[WS]?.activePaneId).toBe(order[2]);
  });

  it("focusPane out-of-range is a no-op", () => {
    useWorkspace.setState({ current: WS, readOnly: false });
    const initial = useEditorLayout.getState().ensureLayout(WS);
    focusPaneCommand(5);
    expect(useEditorLayout.getState().layouts[WS]?.activePaneId).toBe(initial.root.id);
  });

  it("closeActiveTab removes the active tab from the active pane", () => {
    useWorkspace.setState({ current: WS, readOnly: false });
    const initial = useEditorLayout.getState().ensureLayout(WS);
    const paneId = initial.root.id;
    useEditorLayout.getState().setLayout(WS, {
      ...initial,
      root: {
        type: "pane",
        id: paneId,
        tabs: [
          { id: "t1", path: "/a.md", position: POS },
          { id: "t2", path: "/b.md", position: POS },
        ],
        activeTabId: "t2",
      },
    });
    closeActiveTabCommand();
    // biome-ignore lint/style/noNonNullAssertion: the layout was set up above and is guaranteed present.
    const pane = findPane(useEditorLayout.getState().layouts[WS]!.root, paneId);
    if (!pane) throw new Error("expected pane");
    expect(pane.tabs.map((t) => t.id)).toEqual(["t1"]);
    expect(pane.activeTabId).toBe("t1");
  });

  it("closeActiveTab collapses an empty pane back to a fresh empty pane", () => {
    useWorkspace.setState({ current: WS, readOnly: false });
    const initial = useEditorLayout.getState().ensureLayout(WS);
    const paneId = initial.root.id;
    useEditorLayout.getState().setLayout(WS, {
      ...initial,
      root: {
        type: "pane",
        id: paneId,
        tabs: [{ id: "t1", path: "/only.md", position: POS }],
        activeTabId: "t1",
      },
    });
    closeActiveTabCommand();
    // biome-ignore lint/style/noNonNullAssertion: the layout was set up above and is guaranteed present.
    const root = useEditorLayout.getState().layouts[WS]!.root;
    expect(root.type).toBe("pane");
    expect((root as { tabs: unknown[] }).tabs).toEqual([]);
  });

  it("closeActiveTab keeps useTabs entry if the path is open in another pane", () => {
    useWorkspace.setState({ current: WS, readOnly: false });
    useTabs.setState({
      tabs: [{ path: "/shared.md", position: POS }],
      activePath: "/shared.md",
    });
    useEditorLayout.getState().ensureLayout(WS);
    // Build two panes both showing /shared.md.
    useEditorLayout.setState({
      layouts: {
        [WS]: {
          schemaVersion: 1,
          activePaneId: "p1",
          root: {
            type: "split",
            id: "s",
            direction: "horizontal",
            sizes: [0.5, 0.5],
            children: [
              {
                type: "pane",
                id: "p1",
                tabs: [{ id: "t1", path: "/shared.md", position: POS }],
                activeTabId: "t1",
              },
              {
                type: "pane",
                id: "p2",
                tabs: [{ id: "t2", path: "/shared.md", position: POS }],
                activeTabId: "t2",
              },
            ],
          },
        },
      },
    });
    closeActiveTabCommand();
    // p1 emptied → split collapses to p2 alone.
    // biome-ignore lint/style/noNonNullAssertion: the layout was set up above and is guaranteed present.
    const root = useEditorLayout.getState().layouts[WS]!.root;
    expect(root.type).toBe("pane");
    expect((root as { id: string }).id).toBe("p2");
    // The legacy tab list still holds /shared.md (other pane still uses it).
    expect(useTabs.getState().tabs.map((t) => t.path)).toEqual(["/shared.md"]);
  });

  it("moveEditorToNextGroup moves the active tab to the next pane in DFS order", () => {
    useWorkspace.setState({ current: WS, readOnly: false });
    useEditorLayout.setState({
      layouts: {
        [WS]: {
          schemaVersion: 1,
          activePaneId: "p1",
          root: {
            type: "split",
            id: "s",
            direction: "horizontal",
            sizes: [0.5, 0.5],
            children: [
              {
                type: "pane",
                id: "p1",
                tabs: [{ id: "t1", path: "/a.md", position: POS }],
                activeTabId: "t1",
              },
              {
                type: "pane",
                id: "p2",
                tabs: [],
                activeTabId: null,
              },
            ],
          },
        },
      },
    });
    moveEditorToNextGroupCommand();
    const layout = useEditorLayout.getState().layouts[WS];
    if (!layout) throw new Error("expected layout");
    const p2 = findPane(layout.root, "p2");
    if (!p2) throw new Error("expected pane p2");
    expect(p2.tabs.map((t) => t.id)).toEqual(["t1"]);
    expect(layout.activePaneId).toBe("p2");
  });

  it("moveEditorToNextGroup is a no-op with only one pane", () => {
    useWorkspace.setState({ current: WS, readOnly: false });
    const initial = useEditorLayout.getState().ensureLayout(WS);
    useEditorLayout.getState().setLayout(WS, {
      ...initial,
      root: {
        type: "pane",
        id: initial.root.id,
        tabs: [{ id: "t1", path: "/a.md", position: POS }],
        activeTabId: "t1",
      },
    });
    const before = useEditorLayout.getState().layouts[WS]?.root;
    moveEditorToNextGroupCommand();
    expect(useEditorLayout.getState().layouts[WS]?.root).toBe(before);
  });

  it("splitRight no-ops when the workspace has no layout yet", () => {
    useWorkspace.setState({ current: WS, readOnly: false });
    splitRightCommand();
    expect(useEditorLayout.getState().layouts[WS]).toBeUndefined();
  });

  it("splitDown no-ops when the workspace has no layout yet", () => {
    useWorkspace.setState({ current: WS, readOnly: false });
    splitDownCommand();
    expect(useEditorLayout.getState().layouts[WS]).toBeUndefined();
  });

  it("splitDown no-ops without a workspace", () => {
    splitDownCommand();
    expect(useEditorLayout.getState().layouts).toEqual({});
  });

  it("focusPane no-ops without a workspace", () => {
    focusPaneCommand(1);
    expect(useEditorLayout.getState().layouts).toEqual({});
  });

  it("focusPane no-ops when the workspace has no layout yet", () => {
    useWorkspace.setState({ current: WS, readOnly: false });
    focusPaneCommand(1);
    expect(useEditorLayout.getState().layouts[WS]).toBeUndefined();
  });

  it("moveEditorToNextGroup no-ops without a workspace", () => {
    moveEditorToNextGroupCommand();
    expect(useEditorLayout.getState().layouts).toEqual({});
  });

  it("moveEditorToNextGroup no-ops when the workspace has no layout yet", () => {
    useWorkspace.setState({ current: WS, readOnly: false });
    moveEditorToNextGroupCommand();
    expect(useEditorLayout.getState().layouts[WS]).toBeUndefined();
  });

  it("moveEditorToNextGroup no-ops when the active pane has no active tab", () => {
    useWorkspace.setState({ current: WS, readOnly: false });
    useEditorLayout.setState({
      layouts: {
        [WS]: {
          schemaVersion: 1,
          activePaneId: "p1",
          root: {
            type: "split",
            id: "s",
            direction: "horizontal",
            sizes: [0.5, 0.5],
            children: [
              { type: "pane", id: "p1", tabs: [], activeTabId: null },
              { type: "pane", id: "p2", tabs: [], activeTabId: null },
            ],
          },
        },
      },
    });
    const before = useEditorLayout.getState().layouts[WS]?.root;
    moveEditorToNextGroupCommand();
    expect(useEditorLayout.getState().layouts[WS]?.root).toBe(before);
  });

  it("closeActiveTab inside a split with leftover tabs rebuilds the split via replacePaneInLayout", () => {
    useWorkspace.setState({ current: WS, readOnly: false });
    useTabs.setState({
      tabs: [
        { path: "/a.md", position: POS },
        { path: "/b.md", position: POS },
      ],
      activePath: "/a.md",
    });
    useEditorLayout.setState({
      layouts: {
        [WS]: {
          schemaVersion: 1,
          activePaneId: "p1",
          root: {
            type: "split",
            id: "s",
            direction: "horizontal",
            sizes: [0.5, 0.5],
            children: [
              {
                type: "pane",
                id: "p1",
                tabs: [
                  { id: "t1", path: "/a.md", position: POS },
                  { id: "t2", path: "/b.md", position: POS },
                ],
                activeTabId: "t1",
              },
              {
                type: "pane",
                id: "p2",
                tabs: [{ id: "t3", path: "/c.md", position: POS }],
                activeTabId: "t3",
              },
            ],
          },
        },
      },
    });
    closeActiveTabCommand();
    const layout = useEditorLayout.getState().layouts[WS];
    if (!layout || layout.root.type !== "split") throw new Error("expected split root");
    const p1 = findPane(layout.root, "p1");
    if (!p1) throw new Error("expected p1");
    expect(p1.tabs.map((t) => t.id)).toEqual(["t2"]);
    expect(p1.activeTabId).toBe("t2");
  });

  it("closeActiveTab is a no-op when the active pane has no active tab", () => {
    useWorkspace.setState({ current: WS, readOnly: false });
    const initial = useEditorLayout.getState().ensureLayout(WS);
    useEditorLayout.getState().setLayout(WS, {
      ...initial,
      root: { type: "pane", id: initial.root.id, tabs: [], activeTabId: null },
    });
    const before = useEditorLayout.getState().layouts[WS]?.root;
    closeActiveTabCommand();
    expect(useEditorLayout.getState().layouts[WS]?.root).toBe(before);
  });

  it("closeActiveTab falls back to useTabs.close when no pane is active", () => {
    useTabs.setState({
      tabs: [{ path: "/legacy.md", position: POS }],
      activePath: "/legacy.md",
    });
    closeActiveTabCommand();
    expect(useTabs.getState().tabs).toEqual([]);
    expect(useTabs.getState().activePath).toBeNull();
  });
});
