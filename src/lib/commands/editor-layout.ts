// S-ESP-011: split / focus / close keybinding commands.
//
// These wrap the editor-layout store so the keybinding preset and the
// command palette can drive the same actions a mouse drag triggers.
// All commands no-op when there is no current workspace — the welcome
// screen has no panes.

import { useEditorLayout } from "../../store/editor-layout";
import { useTabs } from "../../store/tabs";
import { useWorkspace } from "../../store/workspace";
import { type PaneId, findPane, forEachPane } from "../editor/layout-model";

export function splitRightCommand(): void {
  const ws = useWorkspace.getState().current;
  if (!ws) return;
  const layout = useEditorLayout.getState().layouts[ws];
  if (!layout) return;
  useEditorLayout.getState().splitPane(ws, layout.activePaneId, "horizontal", "after");
}

export function splitDownCommand(): void {
  const ws = useWorkspace.getState().current;
  if (!ws) return;
  const layout = useEditorLayout.getState().layouts[ws];
  if (!layout) return;
  useEditorLayout.getState().splitPane(ws, layout.activePaneId, "vertical", "after");
}

/**
 * Focus the pane at one-based DFS index. Out-of-range no-ops (Mod+3 on a
 * single-pane workspace shouldn't blow up — it's just a missed shortcut).
 */
export function focusPaneCommand(index: number): void {
  const ws = useWorkspace.getState().current;
  if (!ws) return;
  const layout = useEditorLayout.getState().layouts[ws];
  if (!layout) return;
  const order: PaneId[] = [];
  forEachPane(layout.root, (p) => {
    order.push(p.id);
  });
  const target = order[index - 1];
  if (!target) return;
  useEditorLayout.getState().setActivePane(ws, target);
}

/**
 * Close the active tab in the active pane. Falls back to the legacy
 * `useTabs.close` when the new pane-aware model has no active tab (no
 * workspace open, or the pane is empty), so the binding remains useful
 * on the v1.0 single-file shell.
 */
export function closeActiveTabCommand(): void {
  const ws = useWorkspace.getState().current;
  if (ws) {
    const layout = useEditorLayout.getState().layouts[ws];
    if (layout) {
      const pane = findPane(layout.root, layout.activePaneId);
      const activeTabId = pane?.activeTabId ?? null;
      const activeTab = pane?.tabs.find((t) => t.id === activeTabId) ?? null;
      if (pane && activeTab) {
        // Mirror the close into the legacy flat store so any subscriber
        // still reading useTabs (status bar, recent picker) stays in sync.
        const stillOpenElsewhere = pathOpenElsewhere(ws, pane.id, activeTab.id, activeTab.path);
        const nextTabs = pane.tabs.filter((t) => t.id !== activeTab.id);
        if (nextTabs.length === 0) {
          // Pane becomes empty → collapse it via closePane (which itself
          // falls back to a fresh empty pane when the whole tree empties).
          useEditorLayout.getState().closePane(ws, pane.id);
        } else {
          /* v8 ignore next -- nextTabs.length > 0 was checked above, so nextTabs[0] is always defined here; the optional-chain and nullish fallback are TS-defensive */
          const nextActiveId = nextTabs[0]?.id ?? null;
          useEditorLayout.getState().setLayout(ws, {
            ...layout,
            root: replacePaneInLayout(layout.root, pane.id, {
              ...pane,
              tabs: nextTabs,
              activeTabId: nextActiveId,
            }),
          });
        }
        if (!stillOpenElsewhere) {
          useTabs.getState().close(activeTab.path);
        }
        return;
      }
    }
  }
  // Legacy fall-through.
  const active = useTabs.getState().activePath;
  if (active) useTabs.getState().close(active);
}

/**
 * S-ESP-012: move the active tab from the active pane to the next pane in
 * DFS order. Wraps around so the last pane sends to the first. No-op when
 * there's only one pane or no active tab.
 */
export function moveEditorToNextGroupCommand(): void {
  const ws = useWorkspace.getState().current;
  if (!ws) return;
  const layout = useEditorLayout.getState().layouts[ws];
  if (!layout) return;
  const order: PaneId[] = [];
  forEachPane(layout.root, (p) => {
    order.push(p.id);
  });
  if (order.length < 2) return;
  const fromIdx = order.indexOf(layout.activePaneId);
  /* v8 ignore next -- activePaneId is always one of the panes returned by forEachPane(layout.root); the negative-index branch is a defensive guard against store/layout drift */
  if (fromIdx < 0) return;
  const toIdx = (fromIdx + 1) % order.length;
  const fromPaneId = order[fromIdx];
  const toPaneId = order[toIdx];
  /* v8 ignore next -- fromIdx is in [0, order.length-1] after the negative-index guard; the undefined-index branch is TS-defensive */
  if (fromPaneId === undefined || toPaneId === undefined) return;
  const pane = findPane(layout.root, fromPaneId);
  if (!pane || !pane.activeTabId) return;
  useEditorLayout.getState().moveTab(ws, fromPaneId, pane.activeTabId, toPaneId, null);
}

function pathOpenElsewhere(
  workspace: string,
  excludePaneId: PaneId,
  excludeTabId: string,
  path: string,
): boolean {
  const layout = useEditorLayout.getState().layouts[workspace];
  /* v8 ignore next -- callers verify the layout exists before invoking this helper; the early-return is a defensive race guard against store mutation between the call and the check */
  if (!layout) return false;
  let found = false;
  forEachPane(layout.root, (p) => {
    for (const t of p.tabs) {
      if (p.id === excludePaneId && t.id === excludeTabId) continue;
      if (t.path === path) {
        found = true;
        return false;
      }
    }
  });
  return found;
}

function replacePaneInLayout(
  root: import("../editor/layout-model").LayoutNode,
  paneId: PaneId,
  next: import("../editor/layout-model").PaneNode,
): import("../editor/layout-model").LayoutNode {
  if (root.id === paneId && root.type === "pane") return next;
  if (root.type === "pane") return root;
  return {
    ...root,
    children: root.children.map((c) => replacePaneInLayout(c, paneId, next)),
  };
}
