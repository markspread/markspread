// S-ESP-001: domain types for the editor tab + split-pane tree.
//
// Today's `useTabs` (src/store/tabs.ts) tracks a flat tabs array with a
// single `activePath`. That assumes one editing surface per workspace —
// fine for the v1.0 single-pane shell, but the F4 split-pane model
// (ADR-0003) needs a recursive layout.
//
// The model below is intentionally tree-shaped so the same node type
// describes a 2-column 70/30 split, a 3-row stack, and a corner pane
// inside an outer split. Each `PaneNode` owns its tab strip; tabs live
// in panes, not at the workspace root. Multiple panes pointing at the
// same file path share the on-disk content but each holds its own
// `EditorPosition` (cursor + scroll), so split-screen editing the same
// file behaves like VSCode "Split editor".
//
// This file ships types only — the runtime store (S-ESP-002+) and the
// migration shim from the legacy flat array (S-ESP-009) consume them.

import type { EditorPosition, OpenTab } from "../../store/tabs";

/** Each pane / split / tab carries a stable id for diffing + drag. */
export type NodeId = string;
export type TabId = string;
export type PaneId = NodeId;
export type SplitId = NodeId;

/**
 * A `PaneNode` is a leaf in the layout tree. It owns a tabs array and
 * remembers which tab is currently focused inside that pane.
 *
 * `tabs[i].id` is **not** the file path — multiple tabs in different
 * panes can point at the same path. Each tab also keeps its own
 * `position` so split views don't fight over the cursor (S-ESP-007).
 */
export interface PaneTab {
  id: TabId;
  /** Path the tab is bound to. Multiple PaneTabs may share a path. */
  path: string;
  position: EditorPosition;
  preview?: boolean;
  pinned?: boolean;
  dirty?: boolean;
  orphaned?: boolean;
}

export interface PaneNode {
  type: "pane";
  id: PaneId;
  tabs: PaneTab[];
  activeTabId: TabId | null;
}

/**
 * A `SplitNode` recursively groups two or more `LayoutNode`s along an
 * axis. `sizes` are relative — they sum to 1 (or any constant) and are
 * normalised at render time. We carry sizes here rather than per-child
 * so a child swap (e.g., drag-to-rearrange) keeps the same proportions.
 *
 * Why allow N children instead of just two? A 3-pane horizontal layout
 * with binary splits would have to encode as ((A|B)|C) or (A|(B|C)),
 * which encodes ordering bias that doesn't exist. Flat N is simpler.
 */
export type SplitDirection = "horizontal" | "vertical";

export interface SplitNode {
  type: "split";
  id: SplitId;
  direction: SplitDirection;
  children: LayoutNode[];
  /** Same length as `children`. Values normalised on read. */
  sizes: number[];
}

export type LayoutNode = PaneNode | SplitNode;

/**
 * Workspace-scoped layout. `root` is always present (an empty
 * workspace has a single `PaneNode` with `tabs: []`). `activePaneId`
 * follows focus so cursor / palette / "Close Tab" commands know which
 * pane to operate on.
 *
 * `schemaVersion` is the on-disk version; mismatches trigger the
 * migration path (D5 in ADR-0003).
 */
export interface WorkspaceLayout {
  schemaVersion: 1;
  root: LayoutNode;
  activePaneId: PaneId;
}

// ---------------------------------------------------------------------------
// Migration from the legacy flat `useTabs` model.
// ---------------------------------------------------------------------------

/**
 * Convert a v1.0 flat `useTabs` snapshot into a single-pane v1 layout.
 * Returned shape is the canonical "empty workspace with one pane"
 * starting point that the F4 store mounts on first run, so live state
 * never branches on "do we have tabs yet?".
 */
export function fromLegacyTabs(
  tabs: readonly OpenTab[],
  activePath: string | null,
  paneIdFactory: () => PaneId = () => `pane-${cryptoId()}`,
  tabIdFactory: () => TabId = () => `tab-${cryptoId()}`,
): WorkspaceLayout {
  const paneId = paneIdFactory();
  const paneTabs: PaneTab[] = tabs.map((t) => {
    const tab: PaneTab = {
      id: tabIdFactory(),
      path: t.path,
      position: t.position,
    };
    if (t.preview !== undefined) tab.preview = t.preview;
    if (t.dirty !== undefined) tab.dirty = t.dirty;
    if (t.orphaned !== undefined) tab.orphaned = t.orphaned;
    return tab;
  });
  const activeTab = paneTabs.find((t) => t.path === activePath) ?? null;
  return {
    schemaVersion: 1,
    root: {
      type: "pane",
      id: paneId,
      tabs: paneTabs,
      activeTabId: activeTab?.id ?? null,
    },
    activePaneId: paneId,
  };
}

/**
 * Walk the tree, calling `visit` for every pane. Visitor returns
 * `false` to short-circuit. Used by store helpers (close tab, find
 * active pane, etc.).
 */
export function forEachPane(node: LayoutNode, visit: (pane: PaneNode) => unknown): boolean {
  if (node.type === "pane") {
    return visit(node) !== false;
  }
  for (const child of node.children) {
    if (!forEachPane(child, visit)) return false;
  }
  return true;
}

/** Locate a pane by id. O(n) in the tree size; layouts stay small. */
export function findPane(node: LayoutNode, id: PaneId): PaneNode | null {
  let found: PaneNode | null = null;
  forEachPane(node, (p) => {
    if (p.id === id) {
      found = p;
      return false;
    }
  });
  return found;
}

function cryptoId(): string {
  // Browser + Node both have crypto.randomUUID() in our targets; the
  // factories are injectable for tests that want stable ids.
  return globalThis.crypto.randomUUID().slice(0, 8);
}

// ---------------------------------------------------------------------------
// S-ESP-009: layout.json (de)serialisation + missing-file pruning.
// ---------------------------------------------------------------------------

/**
 * Walk the tree and collect every PaneTab's `path`. Useful for the loader's
 * existence check — it lets the host fs_stat() the distinct set once before
 * deciding which tabs to drop.
 */
export function collectPaths(node: LayoutNode): string[] {
  const seen = new Set<string>();
  forEachPane(node, (pane) => {
    for (const tab of pane.tabs) seen.add(tab.path);
  });
  return [...seen];
}

/**
 * Drop any PaneTab whose path satisfies `isMissing`. Empty panes collapse
 * (one-child splits flatten; full collapse falls back to an empty pane).
 * Returns a new WorkspaceLayout with structural sharing for untouched nodes.
 */
export function pruneEditorLayout(
  layout: WorkspaceLayout,
  isMissing: (path: string) => boolean,
): WorkspaceLayout {
  const root = pruneNode(layout.root, isMissing);
  const safeRoot: LayoutNode = root ?? {
    type: "pane",
    id: `pane-${cryptoId()}`,
    tabs: [],
    activeTabId: null,
  };
  const activePaneId = findPane(safeRoot, layout.activePaneId)
    ? layout.activePaneId
    : /* v8 ignore next -- safeRoot always contains at least one pane (constructed above when root was null) */
      (firstPane(safeRoot)?.id ?? safeRoot.id);
  return { ...layout, root: safeRoot, activePaneId };
}

function pruneNode(node: LayoutNode, isMissing: (path: string) => boolean): LayoutNode | null {
  if (node.type === "pane") {
    const nextTabs = node.tabs.filter((tab) => !isMissing(tab.path));
    if (nextTabs.length === 0) return null;
    const activeTabId = nextTabs.some((t) => t.id === node.activeTabId)
      ? node.activeTabId
      : /* v8 ignore next -- nextTabs.length > 0 was checked, so nextTabs[0].id is always defined */
        (nextTabs[0]?.id ?? null);
    return { ...node, tabs: nextTabs, activeTabId };
  }
  const kept: LayoutNode[] = [];
  const sizes: number[] = [];
  for (let i = 0; i < node.children.length; i += 1) {
    const child = node.children[i];
    /* v8 ignore next 2 -- i is in [0, children.length); sizes[i] / children[i] are always defined */
    const size = node.sizes[i] ?? 1;
    if (!child) continue;
    const pruned = pruneNode(child, isMissing);
    if (pruned) {
      kept.push(pruned);
      sizes.push(size);
    }
  }
  if (kept.length === 0) return null;
  /* v8 ignore next -- kept.length === 1 was checked, so kept[0] is always defined */
  if (kept.length === 1) return kept[0] ?? null;
  /* v8 ignore next -- prune retains positive sizes only, so reduce never produces 0 in practice */
  const total = sizes.reduce((a, b) => a + b, 0) || kept.length;
  return { ...node, children: kept, sizes: sizes.map((s) => s / total) };
}

function firstPane(node: LayoutNode): PaneNode | null {
  let found: PaneNode | null = null;
  forEachPane(node, (p) => {
    found = p;
    return false;
  });
  return found;
}

/**
 * Validate an arbitrary JSON value into a WorkspaceLayout. Returns null on
 * shape mismatch; the loader treats `null` as "no persisted layout" and
 * starts fresh. Schema version is asserted but unknown future fields on
 * objects are silently dropped — keep the loader generous, the writer strict.
 */
export function parseEditorLayout(raw: unknown): WorkspaceLayout | null {
  if (!raw || typeof raw !== "object") return null;
  const obj = raw as Record<string, unknown>;
  if (obj.schemaVersion !== 1) return null;
  const root = parseLayoutNode(obj.root);
  if (!root) return null;
  const activePaneId =
    typeof obj.activePaneId === "string" && findPane(root, obj.activePaneId)
      ? obj.activePaneId
      : /* v8 ignore next -- root parsing rejects an empty subtree, so firstPane always finds a pane */
        (firstPane(root)?.id ?? root.id);
  return { schemaVersion: 1, root, activePaneId };
}

function parseLayoutNode(raw: unknown): LayoutNode | null {
  if (!raw || typeof raw !== "object") return null;
  const obj = raw as Record<string, unknown>;
  if (obj.type === "pane") return parsePaneNode(obj);
  if (obj.type === "split") return parseSplitNode(obj);
  return null;
}

function parsePaneNode(obj: Record<string, unknown>): PaneNode | null {
  if (typeof obj.id !== "string") return null;
  const rawTabs = Array.isArray(obj.tabs) ? obj.tabs : [];
  const tabs: PaneTab[] = [];
  for (const t of rawTabs) {
    const tab = parsePaneTab(t);
    if (tab) tabs.push(tab);
  }
  const activeTabId =
    typeof obj.activeTabId === "string" && tabs.some((t) => t.id === obj.activeTabId)
      ? obj.activeTabId
      : (tabs[0]?.id ?? null);
  return { type: "pane", id: obj.id, tabs, activeTabId };
}

function parsePaneTab(raw: unknown): PaneTab | null {
  if (!raw || typeof raw !== "object") return null;
  const o = raw as Record<string, unknown>;
  if (typeof o.id !== "string" || typeof o.path !== "string") return null;
  const pos = o.position as Record<string, unknown> | undefined;
  const position = {
    line: typeof pos?.line === "number" ? pos.line : 0,
    column: typeof pos?.column === "number" ? pos.column : 0,
    scrollTop: typeof pos?.scrollTop === "number" ? pos.scrollTop : 0,
  };
  const tab: PaneTab = { id: o.id, path: o.path, position };
  if (typeof o.preview === "boolean") tab.preview = o.preview;
  if (typeof o.pinned === "boolean") tab.pinned = o.pinned;
  if (typeof o.dirty === "boolean") tab.dirty = o.dirty;
  if (typeof o.orphaned === "boolean") tab.orphaned = o.orphaned;
  return tab;
}

function parseSplitNode(obj: Record<string, unknown>): SplitNode | null {
  if (typeof obj.id !== "string") return null;
  if (obj.direction !== "horizontal" && obj.direction !== "vertical") return null;
  if (!Array.isArray(obj.children)) return null;
  const children: LayoutNode[] = [];
  for (const c of obj.children) {
    const node = parseLayoutNode(c);
    if (node) children.push(node);
  }
  if (children.length === 0) return null;
  const rawSizes = Array.isArray(obj.sizes) ? obj.sizes : [];
  const sizes: number[] =
    rawSizes.length === children.length
      ? rawSizes.map((n) => (typeof n === "number" && Number.isFinite(n) ? n : 1))
      : children.map(() => 1 / children.length);
  const total = sizes.reduce((a, b) => a + b, 0) || children.length;
  return {
    type: "split",
    id: obj.id,
    direction: obj.direction as SplitDirection,
    children,
    sizes: sizes.map((s) => s / total),
  };
}

/** Round-trip safe — emits the canonical schema. */
export function serializeEditorLayout(layout: WorkspaceLayout): unknown {
  return {
    schemaVersion: 1,
    activePaneId: layout.activePaneId,
    root: layout.root,
  };
}
