// S-ESP-003: per-workspace recursive split-pane store.
//
// Each workspace owns a `WorkspaceLayout` (see lib/editor/layout-model.ts).
// This store wraps mutation helpers — split, close, resize, focus — so the
// PaneTree renderer (S-ESP-003) and later persistence (S-ESP-009) can keep
// the tree as the single source of truth.
//
// Mutations always return a new tree (structural sharing) so React selectors
// resubscribe via reference identity.

import { create } from "zustand";
import { type PersistOptions, persist } from "zustand/middleware";
import {
  type LayoutNode,
  type PaneId,
  type PaneNode,
  type SplitDirection,
  type SplitId,
  type SplitNode,
  type TabId,
  type WorkspaceLayout,
  findPane,
  forEachPane,
} from "../lib/editor/layout-model";

export type SplitSide = "before" | "after";

export const PANE_MIN_WIDTH_PX = 160;
export const PANE_MIN_HEIGHT_PX = 120;

interface EditorLayoutState {
  layouts: Record<string, WorkspaceLayout>;
  getLayout: (workspace: string) => WorkspaceLayout;
  ensureLayout: (workspace: string) => WorkspaceLayout;
  setLayout: (workspace: string, layout: WorkspaceLayout) => void;
  splitPane: (
    workspace: string,
    paneId: PaneId,
    direction: SplitDirection,
    side: SplitSide,
  ) => PaneId | null;
  closePane: (workspace: string, paneId: PaneId) => void;
  setSizes: (workspace: string, splitId: SplitId, sizes: number[]) => void;
  setActivePane: (workspace: string, paneId: PaneId) => void;
  /**
   * S-ESP-004: move a tab from one pane to another. If `toPaneId === fromPaneId`
   * the tab is reordered within the same pane (`toIndex`, or appended if null).
   * Returns true when the move actually changed something; false when the
   * source/destination/tab can't be resolved.
   */
  moveTab: (
    workspace: string,
    fromPaneId: PaneId,
    tabId: TabId,
    toPaneId: PaneId,
    toIndex: number | null,
  ) => boolean;
  /**
   * S-ESP-004: split `targetPaneId` along `direction` (creating a new pane on
   * `side`), then move the tab into the new pane. Empty source panes are
   * collapsed away just like `closePane`. Returns the new pane id, or null if
   * the tab/pane couldn't be resolved.
   */
  splitWithTab: (
    workspace: string,
    fromPaneId: PaneId,
    tabId: TabId,
    targetPaneId: PaneId,
    direction: SplitDirection,
    side: SplitSide,
  ) => PaneId | null;
  /**
   * S-ESP-006: persist per-pane view state. Same path opened in two panes
   * keeps two independent positions (cursor + scroll) — the PaneTab.position
   * is the canonical store.
   */
  setTabPosition: (
    workspace: string,
    paneId: PaneId,
    tabId: TabId,
    position: { line: number; column: number; scrollTop: number },
  ) => void;
  /** Replace the active tab inside a pane. No-op if the pane/tab can't be resolved. */
  setActiveTab: (workspace: string, paneId: PaneId, tabId: TabId) => void;
  /**
   * S-ESP-002: remove a tab from its pane. Activates the neighbour tab when
   * the closed tab was active; leaves the pane in place even if it ends up
   * with zero tabs (panes are closed explicitly via `closePane`).
   */
  closeTab: (workspace: string, paneId: PaneId, tabId: TabId) => void;
  /** Toggle a tab's pinned flag. */
  setTabPinned: (workspace: string, paneId: PaneId, tabId: TabId, pinned: boolean) => void;
}

function emptyLayout(): WorkspaceLayout {
  const paneId = `pane-${randId()}`;
  return {
    schemaVersion: 1,
    root: { type: "pane", id: paneId, tabs: [], activeTabId: null },
    activePaneId: paneId,
  };
}

function randId(): string {
  return globalThis.crypto.randomUUID().slice(0, 8);
}

function clonePane(pane: PaneNode): PaneNode {
  return { ...pane, id: `pane-${randId()}`, tabs: [], activeTabId: null };
}

/**
 * Replace a node in the tree by id. Returns a new root (structural share).
 * `replacer` is invoked with the matched node and must return its replacement
 * (or `null` to delete; the caller is responsible for valid parents).
 */
function replaceNode(
  root: LayoutNode,
  id: string,
  replacer: (node: LayoutNode) => LayoutNode | null,
): { root: LayoutNode | null; changed: boolean } {
  if (root.id === id) {
    return { root: replacer(root), changed: true };
  }
  if (root.type === "pane") return { root, changed: false };
  let changed = false;
  const newChildren: LayoutNode[] = [];
  const newSizes: number[] = [];
  for (let i = 0; i < root.children.length; i += 1) {
    const child = root.children[i];
    const size = root.sizes[i] ?? 1;
    if (!child) continue;
    const res = replaceNode(child, id, replacer);
    if (res.changed) changed = true;
    if (res.root) {
      newChildren.push(res.root);
      newSizes.push(size);
    }
  }
  if (!changed) return { root, changed: false };
  // Collapse parent splits that no longer make sense.
  if (newChildren.length === 0) return { root: null, changed: true };
  if (newChildren.length === 1) {
    return { root: newChildren[0] ?? null, changed: true };
  }
  // Renormalise sizes so removed children don't leave gaps.
  const total = newSizes.reduce((a, b) => a + b, 0) || newChildren.length;
  const normalised = newSizes.map((s) => s / total);
  const next: SplitNode = {
    ...root,
    children: newChildren,
    sizes: normalised,
  };
  return { root: next, changed: true };
}

/**
 * Replace `target` with a split node that puts `target` and `newPane` along
 * `direction`. `side` decides whether `newPane` is inserted before or after.
 * If the parent split already has the same direction, the child is added in
 * place to keep the tree flat (avoids ((A|B)|C) drift).
 */
function splitAt(
  root: LayoutNode,
  paneId: PaneId,
  direction: SplitDirection,
  side: SplitSide,
  newPane: PaneNode,
): LayoutNode {
  // First try the "extend existing parent split" path.
  const extended = extendParent(root, paneId, direction, side, newPane);
  if (extended) return extended;

  const res = replaceNode(root, paneId, (node) => {
    if (node.type !== "pane") return node;
    const split: SplitNode = {
      type: "split",
      id: `split-${randId()}`,
      direction,
      children: side === "before" ? [newPane, node] : [node, newPane],
      sizes: [0.5, 0.5],
    };
    return split;
  });
  return res.root ?? root;
}

function extendParent(
  root: LayoutNode,
  paneId: PaneId,
  direction: SplitDirection,
  side: SplitSide,
  newPane: PaneNode,
): LayoutNode | null {
  if (root.type === "pane") return null;
  // Is the target a direct child of `root`, and does `root` already match the
  // requested direction? Then just insert next to it.
  if (root.direction === direction) {
    const idx = root.children.findIndex((c) => c.id === paneId);
    if (idx >= 0) {
      const insertAt = side === "before" ? idx : idx + 1;
      const nextChildren = root.children.slice();
      nextChildren.splice(insertAt, 0, newPane);
      const equal = 1 / nextChildren.length;
      return {
        ...root,
        children: nextChildren,
        sizes: nextChildren.map(() => equal),
      };
    }
  }
  for (const child of root.children) {
    const r = extendParent(child, paneId, direction, side, newPane);
    if (r) {
      return {
        ...root,
        children: root.children.map((c) => (c === child ? r : c)),
      };
    }
  }
  return null;
}

/**
 * Remove `tabId` from `fromPaneId` and insert it into `toPaneId` at `toIndex`
 * (or append if null). If the source pane becomes empty it is collapsed via
 * `replaceNode` so parent splits clean up automatically.
 */
function applyMoveTab(
  root: LayoutNode,
  fromPaneId: PaneId,
  tabId: TabId,
  toPaneId: PaneId,
  toIndex: number | null,
): { root: LayoutNode | null; changed: boolean } {
  const src = findPane(root, fromPaneId);
  if (!src) return { root, changed: false };
  const tab = src.tabs.find((t) => t.id === tabId);
  if (!tab) return { root, changed: false };

  // Step 1: clone the tab and prepare the source pane without it.
  const remaining = src.tabs.filter((t) => t.id !== tabId);
  const srcEmpty = remaining.length === 0;

  // Step 2: helper to insert into the target pane.
  const insertInto = (target: PaneNode): PaneNode => {
    const isSamePane = target.id === fromPaneId;
    const base = isSamePane ? remaining : target.tabs;
    const at = toIndex == null ? base.length : Math.max(0, Math.min(toIndex, base.length));
    const nextTabs = base.slice();
    nextTabs.splice(at, 0, tab);
    return { ...target, tabs: nextTabs, activeTabId: tab.id };
  };

  // Same pane reorder: single replace.
  if (fromPaneId === toPaneId) {
    const res = replaceNode(root, fromPaneId, (node) =>
      node.type === "pane" ? insertInto(node) : node,
    );
    return res;
  }

  // Cross-pane: replace target first, then strip / remove source.
  const afterInsert = replaceNode(root, toPaneId, (node) =>
    node.type === "pane" ? insertInto(node) : node,
  );
  if (!afterInsert.changed || !afterInsert.root) return afterInsert;
  const afterRemove = replaceNode(afterInsert.root, fromPaneId, (node) => {
    if (node.type !== "pane") return node;
    if (srcEmpty) return null;
    return { ...node, tabs: remaining, activeTabId: remaining[0]?.id ?? null };
  });
  return afterRemove.changed ? afterRemove : afterInsert;
}

function firstPaneId(node: LayoutNode): PaneId {
  let id: PaneId | null = null;
  forEachPane(node, (p) => {
    id = p.id;
    return false;
  });
  return id ?? "";
}

const persistOptions: PersistOptions<EditorLayoutState, Pick<EditorLayoutState, "layouts">> = {
  name: "ms.editor-layout",
  version: 1,
  partialize: (state) => ({ layouts: state.layouts }),
};

export const useEditorLayout = create<EditorLayoutState>()(
  persist(
    (set, get) => ({
      layouts: {},
      getLayout: (workspace) => get().layouts[workspace] ?? emptyLayout(),
      ensureLayout: (workspace) => {
        const existing = get().layouts[workspace];
        if (existing) return existing;
        const fresh = emptyLayout();
        set({ layouts: { ...get().layouts, [workspace]: fresh } });
        return fresh;
      },
      setLayout: (workspace, layout) => {
        set({ layouts: { ...get().layouts, [workspace]: layout } });
      },
      splitPane: (workspace, paneId, direction, side) => {
        const layout = get().layouts[workspace];
        if (!layout) return null;
        const source = findPane(layout.root, paneId);
        if (!source) return null;
        const fresh = clonePane(source);
        const nextRoot = splitAt(layout.root, paneId, direction, side, fresh);
        set({
          layouts: {
            ...get().layouts,
            [workspace]: {
              ...layout,
              root: nextRoot,
              activePaneId: fresh.id,
            },
          },
        });
        return fresh.id;
      },
      closePane: (workspace, paneId) => {
        const layout = get().layouts[workspace];
        if (!layout) return;
        const res = replaceNode(layout.root, paneId, () => null);
        if (!res.changed) return;
        // If we collapsed the whole tree away, fall back to an empty pane.
        const nextRoot: LayoutNode = res.root ?? {
          type: "pane",
          id: `pane-${randId()}`,
          tabs: [],
          activeTabId: null,
        };
        const nextActive = findPane(nextRoot, layout.activePaneId)
          ? layout.activePaneId
          : firstPaneId(nextRoot);
        set({
          layouts: {
            ...get().layouts,
            [workspace]: {
              ...layout,
              root: nextRoot,
              activePaneId: nextActive,
            },
          },
        });
      },
      setSizes: (workspace, splitId, sizes) => {
        const layout = get().layouts[workspace];
        if (!layout) return;
        const res = replaceNode(layout.root, splitId, (node) => {
          if (node.type !== "split") return node;
          if (node.sizes.length !== sizes.length) return node;
          const total = sizes.reduce((a, b) => a + b, 0) || 1;
          return { ...node, sizes: sizes.map((s) => s / total) };
        });
        if (!res.changed || !res.root) return;
        set({
          layouts: {
            ...get().layouts,
            [workspace]: { ...layout, root: res.root },
          },
        });
      },
      moveTab: (workspace, fromPaneId, tabId, toPaneId, toIndex) => {
        const layout = get().layouts[workspace];
        if (!layout) return false;
        const src = findPane(layout.root, fromPaneId);
        if (!src) return false;
        const tab = src.tabs.find((t) => t.id === tabId);
        if (!tab) return false;
        // No-op reorder within the same pane to the same slot.
        if (fromPaneId === toPaneId) {
          const curIdx = src.tabs.findIndex((t) => t.id === tabId);
          const insertAt =
            toIndex == null ? src.tabs.length - 1 : Math.min(toIndex, src.tabs.length - 1);
          if (curIdx === insertAt) return false;
        }
        const nextRoot = applyMoveTab(layout.root, fromPaneId, tabId, toPaneId, toIndex);
        if (!nextRoot.changed || !nextRoot.root) return false;
        const finalRoot = nextRoot.root;
        const activePaneId = findPane(finalRoot, toPaneId) ? toPaneId : firstPaneId(finalRoot);
        set({
          layouts: {
            ...get().layouts,
            [workspace]: {
              ...layout,
              root: finalRoot,
              activePaneId,
            },
          },
        });
        return true;
      },
      splitWithTab: (workspace, fromPaneId, tabId, targetPaneId, direction, side) => {
        const layout = get().layouts[workspace];
        if (!layout) return null;
        const src = findPane(layout.root, fromPaneId);
        const tgt = findPane(layout.root, targetPaneId);
        if (!src || !tgt) return null;
        const tab = src.tabs.find((t) => t.id === tabId);
        if (!tab) return null;
        // Only-tab-in-only-pane edge case: nothing to split into.
        if (fromPaneId === targetPaneId && src.tabs.length === 1) return null;
        const newPane: PaneNode = {
          type: "pane",
          id: `pane-${randId()}`,
          tabs: [],
          activeTabId: null,
        };
        // Insert new pane next to target, then move the tab into it.
        const afterSplit = splitAt(layout.root, targetPaneId, direction, side, newPane);
        const moved = applyMoveTab(afterSplit, fromPaneId, tabId, newPane.id, null);
        if (!moved.changed || !moved.root) return null;
        set({
          layouts: {
            ...get().layouts,
            [workspace]: {
              ...layout,
              root: moved.root,
              activePaneId: newPane.id,
            },
          },
        });
        return newPane.id;
      },
      setTabPosition: (workspace, paneId, tabId, position) => {
        const layout = get().layouts[workspace];
        if (!layout) return;
        const res = replaceNode(layout.root, paneId, (node) => {
          if (node.type !== "pane") return node;
          let touched = false;
          const nextTabs = node.tabs.map((tab) => {
            if (tab.id !== tabId) return tab;
            if (
              tab.position.line === position.line &&
              tab.position.column === position.column &&
              tab.position.scrollTop === position.scrollTop
            ) {
              return tab;
            }
            touched = true;
            return { ...tab, position };
          });
          if (!touched) return node;
          return { ...node, tabs: nextTabs };
        });
        if (!res.changed || !res.root) return;
        set({
          layouts: {
            ...get().layouts,
            [workspace]: { ...layout, root: res.root },
          },
        });
      },
      setActiveTab: (workspace, paneId, tabId) => {
        const layout = get().layouts[workspace];
        if (!layout) return;
        const res = replaceNode(layout.root, paneId, (node) => {
          if (node.type !== "pane") return node;
          if (node.activeTabId === tabId) return node;
          if (!node.tabs.some((t) => t.id === tabId)) return node;
          return { ...node, activeTabId: tabId };
        });
        if (!res.changed || !res.root) return;
        set({
          layouts: {
            ...get().layouts,
            [workspace]: { ...layout, root: res.root, activePaneId: paneId },
          },
        });
      },
      setActivePane: (workspace, paneId) => {
        const layout = get().layouts[workspace];
        if (!layout) return;
        if (layout.activePaneId === paneId) return;
        if (!findPane(layout.root, paneId)) return;
        set({
          layouts: {
            ...get().layouts,
            [workspace]: { ...layout, activePaneId: paneId },
          },
        });
      },
      closeTab: (workspace, paneId, tabId) => {
        const layout = get().layouts[workspace];
        if (!layout) return;
        const res = replaceNode(layout.root, paneId, (node) => {
          if (node.type !== "pane") return node;
          const idx = node.tabs.findIndex((t) => t.id === tabId);
          if (idx < 0) return node;
          const nextTabs = node.tabs.filter((t) => t.id !== tabId);
          let nextActive = node.activeTabId;
          if (node.activeTabId === tabId) {
            const neighbour = nextTabs[idx] ?? nextTabs[idx - 1] ?? null;
            nextActive = neighbour?.id ?? null;
          }
          return { ...node, tabs: nextTabs, activeTabId: nextActive };
        });
        if (!res.changed || !res.root) return;
        set({
          layouts: {
            ...get().layouts,
            [workspace]: { ...layout, root: res.root },
          },
        });
      },
      setTabPinned: (workspace, paneId, tabId, pinned) => {
        const layout = get().layouts[workspace];
        if (!layout) return;
        const res = replaceNode(layout.root, paneId, (node) => {
          if (node.type !== "pane") return node;
          let touched = false;
          const nextTabs = node.tabs.map((tab) => {
            if (tab.id !== tabId) return tab;
            if ((tab.pinned ?? false) === pinned) return tab;
            touched = true;
            return { ...tab, pinned };
          });
          if (!touched) return node;
          return { ...node, tabs: nextTabs };
        });
        if (!res.changed || !res.root) return;
        set({
          layouts: {
            ...get().layouts,
            [workspace]: { ...layout, root: res.root },
          },
        });
      },
    }),
    persistOptions,
  ),
);
