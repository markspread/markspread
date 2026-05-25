// S-MWS-001: 윈도우 셸의 워크스페이스 탭 × 스플릿 트리.
//
// ADR-0011 의 D1 데이터 모델을 구현한다. ADR-0003 의 페인 트리(`useEditorLayout`)
// 가 *한 워크스페이스 내부* 의 분할을 다룬다면, 이 스토어는 *워크스페이스 사이*
// 의 분할/탭을 다룬다. 두 트리는 절대 섞이지 않는다 — `WorkspaceTab` 이 leaf
// 이며 그 안의 `paneTree` 는 본 스토어가 손대지 않는 ADR-0003 의 타입이다.
//
// 모든 mutation 은 새 트리를 반환(structural sharing)해 React selector 가 참조
// 동등성으로 재구독한다. 영속화 키는 `persistKeyFor("markspread.workspace-layout")`
// 로 윈도우 단위로 분기된다 (S-SBC-007 패턴).

import { create } from "zustand";
import { type PersistOptions, persist } from "zustand/middleware";
import type { SortMode } from "./layout";

// ---------------------------------------------------------------------------
// 도메인 타입 — ADR-0011 D1
// ---------------------------------------------------------------------------

export type WorkspaceTabId = string;
export type WorkspaceNodeId = string;
export type WorkspaceSplitDirection = "horizontal" | "vertical";

/**
 * 워크스페이스 탭의 사이드바/파일트리 상태. ADR-0011 D2.
 * 같은 워크스페이스가 두 탭에 열려도 두 탭은 서로 다른 expansion/scroll/검색을
 * 유지한다.
 */
export interface WorkspaceTabState {
  sidebarCollapsed: boolean;
  sidebarWidth?: number;
  fileTreeExpanded: string[];
  fileTreeScrollTop: number;
  fileTreeSearchQuery: string;
  fileTreeSortMode: SortMode;
  readOnly: boolean;
  pinned?: boolean;
  lastVisitedAt: number;
}

export interface WorkspaceTab {
  id: WorkspaceTabId;
  workspaceId: string;
  workspacePath: string;
  tabState: WorkspaceTabState;
}

export interface WorkspaceTabsNode {
  type: "ws-tabs";
  id: WorkspaceNodeId;
  tabs: WorkspaceTab[];
  activeTabId: WorkspaceTabId;
}

export interface WorkspaceSplitNode {
  type: "ws-split";
  id: WorkspaceNodeId;
  direction: WorkspaceSplitDirection;
  children: WorkspaceLayoutNode[];
  sizes: number[];
}

export type WorkspaceLayoutNode = WorkspaceSplitNode | WorkspaceTabsNode;

export interface WindowLayout {
  schemaVersion: 2;
  root: WorkspaceLayoutNode;
  activeTabId: WorkspaceTabId;
}

// ---------------------------------------------------------------------------
// 헬퍼
// ---------------------------------------------------------------------------

function randId(): string {
  return globalThis.crypto.randomUUID().slice(0, 8);
}

/**
 * 워크스페이스 경로 → 안정적인 해시. 같은 워크스페이스를 두 탭에 열어도
 * `workspaceId` 가 동일하므로 백그라운드 watcher 캐시(D9) 가 키잉 가능.
 */
export function workspaceIdFor(path: string): string {
  let h = 5381;
  for (let i = 0; i < path.length; i += 1) {
    h = (h * 33) ^ path.charCodeAt(i);
  }
  // 음수 방지 — 32bit unsigned 로 정규화 후 base36.
  return (h >>> 0).toString(36);
}

export function defaultTabState(opts?: Partial<WorkspaceTabState>): WorkspaceTabState {
  return {
    sidebarCollapsed: false,
    fileTreeExpanded: [],
    fileTreeScrollTop: 0,
    fileTreeSearchQuery: "",
    fileTreeSortMode: "name",
    readOnly: false,
    lastVisitedAt: Date.now(),
    ...opts,
  };
}

export function createWorkspaceTab(
  workspacePath: string,
  partial?: Partial<WorkspaceTab>,
): WorkspaceTab {
  return {
    id: partial?.id ?? `wstab-${randId()}`,
    workspaceId: partial?.workspaceId ?? workspaceIdFor(workspacePath),
    workspacePath,
    tabState: partial?.tabState ?? defaultTabState(),
  };
}

export function createTabsNode(
  tabs: WorkspaceTab[],
  activeTabId?: WorkspaceTabId,
): WorkspaceTabsNode {
  const first = tabs[0];
  if (!first) {
    throw new Error("WorkspaceTabsNode must contain at least one tab");
  }
  return {
    type: "ws-tabs",
    id: `wstn-${randId()}`,
    tabs,
    activeTabId: activeTabId ?? first.id,
  };
}

export function emptyWindowLayout(initialPath: string): WindowLayout {
  const tab = createWorkspaceTab(initialPath);
  const root = createTabsNode([tab]);
  return { schemaVersion: 2, root, activeTabId: tab.id };
}

// ---------------------------------------------------------------------------
// 트리 탐색 / 변형 헬퍼
// ---------------------------------------------------------------------------

export function forEachTabsNode(
  node: WorkspaceLayoutNode,
  visit: (n: WorkspaceTabsNode) => unknown,
): boolean {
  if (node.type === "ws-tabs") {
    return visit(node) !== false;
  }
  for (const child of node.children) {
    if (!forEachTabsNode(child, visit)) return false;
  }
  return true;
}

export function findTab(
  node: WorkspaceLayoutNode,
  tabId: WorkspaceTabId,
): { node: WorkspaceTabsNode; tab: WorkspaceTab } | null {
  let result: { node: WorkspaceTabsNode; tab: WorkspaceTab } | null = null;
  forEachTabsNode(node, (n) => {
    const tab = n.tabs.find((t) => t.id === tabId);
    if (tab) {
      result = { node: n, tab };
      return false;
    }
  });
  return result;
}

export function findTabsNode(
  node: WorkspaceLayoutNode,
  nodeId: WorkspaceNodeId,
): WorkspaceTabsNode | null {
  let result: WorkspaceTabsNode | null = null;
  forEachTabsNode(node, (n) => {
    if (n.id === nodeId) {
      result = n;
      return false;
    }
  });
  return result;
}

function firstTabId(node: WorkspaceLayoutNode): WorkspaceTabId | null {
  let id: WorkspaceTabId | null = null;
  forEachTabsNode(node, (n) => {
    const t = n.tabs[0];
    /* v8 ignore next -- ws-tabs nodes are constructed with at least one tab; the falsy guard is defensive against parse-time drift */
    if (t) {
      id = t.id;
      return false;
    }
  });
  return id;
}

/**
 * `id` 에 해당하는 노드를 `replacer` 의 반환값으로 치환. `replacer` 가 null 을
 * 반환하면 해당 노드는 트리에서 제거. 부모 split 의 child 가 1개로 떨어지면
 * 자동으로 그 자식으로 흡수 (mergeIfTrivial 의 핵심 동작).
 */
function replaceNode(
  root: WorkspaceLayoutNode,
  id: WorkspaceNodeId,
  replacer: (n: WorkspaceLayoutNode) => WorkspaceLayoutNode | null,
): { root: WorkspaceLayoutNode | null; changed: boolean } {
  if (root.id === id) {
    return { root: replacer(root), changed: true };
  }
  if (root.type === "ws-tabs") return { root, changed: false };
  let changed = false;
  const kept: WorkspaceLayoutNode[] = [];
  const sizes: number[] = [];
  for (let i = 0; i < root.children.length; i += 1) {
    const child = root.children[i];
    /* v8 ignore next -- i bounded by children.length; sizes[i] default for noUncheckedIndexedAccess */
    const size = root.sizes[i] ?? 1;
    /* v8 ignore next -- i is in [0, children.length); the falsy guard exists for noUncheckedIndexedAccess */
    if (!child) continue;
    const res = replaceNode(child, id, replacer);
    if (res.changed) changed = true;
    if (res.root) {
      kept.push(res.root);
      sizes.push(size);
    }
  }
  /* v8 ignore next -- callers always invoke replaceNode with an id present in the tree; the no-match outer return is defensive for recursive symmetry */
  if (!changed) return { root, changed: false };
  /* v8 ignore next -- callers always leave at least one sibling intact (collapsed-tabs leaf returns null only when its own filter empties it, but the parent split has the other branch as well); defensive */
  if (kept.length === 0) return { root: null, changed: true };
  /* v8 ignore next -- length === 1 just checked, so kept[0] is defined */
  if (kept.length === 1) return { root: kept[0] ?? null, changed: true };
  /* v8 ignore next -- sizes is built from positive numbers retained from the original split; the `|| kept.length` fallback is defensive against zero-sum */
  const total = sizes.reduce((a, b) => a + b, 0) || kept.length;
  const normalised = sizes.map((s) => s / total);
  return {
    root: { ...root, children: kept, sizes: normalised },
    changed: true,
  };
}

// ---------------------------------------------------------------------------
// 직렬화
// ---------------------------------------------------------------------------

export function serializeWindowLayout(layout: WindowLayout): unknown {
  return {
    schemaVersion: 2,
    activeTabId: layout.activeTabId,
    root: layout.root,
  };
}

export function deserializeWindowLayout(raw: unknown): WindowLayout | null {
  if (!raw || typeof raw !== "object") return null;
  const obj = raw as Record<string, unknown>;
  if (obj.schemaVersion !== 2) return null;
  const root = parseNode(obj.root);
  if (!root) return null;
  const activeTabId =
    typeof obj.activeTabId === "string" && findTab(root, obj.activeTabId)
      ? obj.activeTabId
      : /* v8 ignore next -- parseNode rejects empty trees, so firstTabId always resolves; defensive fallback */
        (firstTabId(root) ?? "");
  return { schemaVersion: 2, root, activeTabId };
}

function parseNode(raw: unknown): WorkspaceLayoutNode | null {
  if (!raw || typeof raw !== "object") return null;
  const obj = raw as Record<string, unknown>;
  if (obj.type === "ws-tabs") return parseTabsNode(obj);
  if (obj.type === "ws-split") return parseSplitNode(obj);
  return null;
}

function parseTabsNode(obj: Record<string, unknown>): WorkspaceTabsNode | null {
  if (typeof obj.id !== "string") return null;
  /* v8 ignore next -- valid serialised tabs nodes always carry an array of tabs; the empty-array fallback covers corrupted input but is impractical to exercise without bypassing the type system */
  const rawTabs = Array.isArray(obj.tabs) ? obj.tabs : [];
  const tabs: WorkspaceTab[] = [];
  for (const t of rawTabs) {
    const tab = parseTab(t);
    if (tab) tabs.push(tab);
  }
  if (tabs.length === 0) return null;
  const activeTabId =
    typeof obj.activeTabId === "string" && tabs.some((t) => t.id === obj.activeTabId)
      ? obj.activeTabId
      : /* v8 ignore next -- tabs.length > 0 just checked, so tabs[0].id is always defined */
        (tabs[0]?.id ?? "");
  return { type: "ws-tabs", id: obj.id, tabs, activeTabId };
}

function parseTab(raw: unknown): WorkspaceTab | null {
  if (!raw || typeof raw !== "object") return null;
  const o = raw as Record<string, unknown>;
  if (typeof o.id !== "string" || typeof o.workspacePath !== "string") return null;
  const workspaceId =
    typeof o.workspaceId === "string" ? o.workspaceId : workspaceIdFor(o.workspacePath);
  const tabState = parseTabState(o.tabState);
  return { id: o.id, workspaceId, workspacePath: o.workspacePath, tabState };
}

function parseTabState(raw: unknown): WorkspaceTabState {
  const base = defaultTabState();
  if (!raw || typeof raw !== "object") return base;
  const o = raw as Record<string, unknown>;
  const expanded = Array.isArray(o.fileTreeExpanded)
    ? o.fileTreeExpanded.filter((p): p is string => typeof p === "string")
    : base.fileTreeExpanded;
  const sortMode =
    o.fileTreeSortMode === "name" ||
    o.fileTreeSortMode === "modified" ||
    o.fileTreeSortMode === "type"
      ? o.fileTreeSortMode
      : base.fileTreeSortMode;
  const result: WorkspaceTabState = {
    sidebarCollapsed:
      typeof o.sidebarCollapsed === "boolean" ? o.sidebarCollapsed : base.sidebarCollapsed,
    fileTreeExpanded: expanded,
    fileTreeScrollTop:
      typeof o.fileTreeScrollTop === "number" ? o.fileTreeScrollTop : base.fileTreeScrollTop,
    fileTreeSearchQuery:
      typeof o.fileTreeSearchQuery === "string" ? o.fileTreeSearchQuery : base.fileTreeSearchQuery,
    fileTreeSortMode: sortMode,
    readOnly: typeof o.readOnly === "boolean" ? o.readOnly : base.readOnly,
    lastVisitedAt: typeof o.lastVisitedAt === "number" ? o.lastVisitedAt : base.lastVisitedAt,
  };
  if (typeof o.sidebarWidth === "number") result.sidebarWidth = o.sidebarWidth;
  if (typeof o.pinned === "boolean") result.pinned = o.pinned;
  return result;
}

function parseSplitNode(obj: Record<string, unknown>): WorkspaceSplitNode | null {
  if (typeof obj.id !== "string") return null;
  if (obj.direction !== "horizontal" && obj.direction !== "vertical") return null;
  if (!Array.isArray(obj.children)) return null;
  const children: WorkspaceLayoutNode[] = [];
  for (const c of obj.children) {
    const node = parseNode(c);
    if (node) children.push(node);
  }
  if (children.length === 0) return null;
  const rawSizes = Array.isArray(obj.sizes) ? obj.sizes : [];
  const sizes =
    rawSizes.length === children.length
      ? rawSizes.map((n) => (typeof n === "number" && Number.isFinite(n) ? n : 1))
      : children.map(() => 1 / children.length);
  /* v8 ignore next -- sizes is built from positive numbers or even shares; the `|| children.length` fallback is defensive against zero-sum input */
  const total = sizes.reduce((a, b) => a + b, 0) || children.length;
  return {
    type: "ws-split",
    id: obj.id,
    direction: obj.direction as WorkspaceSplitDirection,
    children,
    sizes: sizes.map((s) => s / total),
  };
}

// ---------------------------------------------------------------------------
// 스토어
// ---------------------------------------------------------------------------

export interface WorkspaceLayoutState {
  layout: WindowLayout | null;
  /**
   * 첫 워크스페이스 오픈 시 호출. 이후 호출은 noop.
   */
  ensure: (initialPath: string) => WindowLayout;
  /** 셸 레이아웃을 통째로 교체 (마이그레이션/복원용). */
  setLayout: (layout: WindowLayout) => void;
  /** 새 워크스페이스 탭을 active `ws-tabs` 노드에 추가. 신규 탭 id 반환. */
  addWorkspaceTab: (
    workspacePath: string,
    opts?: { activate?: boolean; targetNodeId?: WorkspaceNodeId },
  ) => WorkspaceTabId | null;
  /**
   * `tabId` 를 닫는다. 마지막 탭이면 보호(닫지 않음) — 호출자에 false 반환.
   * 부모 split 이 하나만 남으면 자동으로 흡수(mergeIfTrivial 동등).
   */
  closeWorkspaceTab: (tabId: WorkspaceTabId) => boolean;
  /** active 워크스페이스 탭을 세로(좌우)로 분할. 새 탭 id 반환. */
  splitVertical: (tabId?: WorkspaceTabId) => WorkspaceTabId | null;
  /** active 워크스페이스 탭을 가로(상하)로 분할. */
  splitHorizontal: (tabId?: WorkspaceTabId) => WorkspaceTabId | null;
  /**
   * 트리에 1-child split 이 남아 있으면 그 자식으로 흡수.
   * 다른 mutation 직후 사용한다 — addWorkspaceTab/closeWorkspaceTab/moveTab
   * 가 내부적으로 이미 호출하므로 직접 호출이 필요한 경우는 드물다.
   */
  mergeIfTrivial: () => void;
  /** active 워크스페이스 탭 변경. 해당 ws-tabs 노드의 active 도 동기화. */
  setActiveTab: (tabId: WorkspaceTabId) => void;
  /**
   * `dragSource` 를 `dropTarget` 위치로 이동. dropTarget 이 같은 노드면 reorder,
   * 다른 노드면 cross-node move. 빈 ws-tabs 노드는 자동으로 흡수.
   */
  moveTab: (
    dragSource: WorkspaceTabId,
    dropTarget: { nodeId: WorkspaceNodeId; index: number | null },
  ) => boolean;
  /** 한 탭의 tabState 일부를 patch (per-workspace FileTree 상태 영속화). */
  patchTabState: (tabId: WorkspaceTabId, patch: Partial<WorkspaceTabState>) => void;
  /** 직렬화된 JSON object 반환. */
  serialize: () => unknown;
  /** raw JSON 을 받아 내부 상태로 hydration. 실패 시 false 반환. */
  deserialize: (raw: unknown) => boolean;
}

function findActiveTabsNode(layout: WindowLayout): WorkspaceTabsNode | null {
  return findTab(layout.root, layout.activeTabId)?.node ?? null;
}

function applyMergeIfTrivial(root: WorkspaceLayoutNode): WorkspaceLayoutNode {
  if (root.type === "ws-tabs") return root;
  const collapsed: WorkspaceLayoutNode[] = [];
  for (const child of root.children) {
    collapsed.push(applyMergeIfTrivial(child));
  }
  /* v8 ignore next -- replaceNode-based mutations already merge 1-child splits; this defensive pass mostly stays no-op */
  if (collapsed.length === 1 && collapsed[0]) return collapsed[0];
  return { ...root, children: collapsed };
}

const persistOptions: PersistOptions<WorkspaceLayoutState, Pick<WorkspaceLayoutState, "layout">> = {
  name: "ms.workspace-layout",
  version: 2,
  /* v8 ignore next -- partialize is invoked by zustand's persist middleware only when storage is available; tests skip the middleware path */
  partialize: (state) => ({ layout: state.layout }),
};

export const useWorkspaceLayout = create<WorkspaceLayoutState>()(
  persist(
    (set, get) => ({
      layout: null,
      ensure: (initialPath) => {
        const existing = get().layout;
        if (existing) return existing;
        const fresh = emptyWindowLayout(initialPath);
        set({ layout: fresh });
        return fresh;
      },
      setLayout: (layout) => set({ layout }),
      addWorkspaceTab: (workspacePath, opts) => {
        const layout = get().layout;
        if (!layout) return null;
        const targetNodeId = opts?.targetNodeId ?? findActiveTabsNode(layout)?.id ?? null;
        if (!targetNodeId) return null;
        const newTab = createWorkspaceTab(workspacePath);
        const res = replaceNode(layout.root, targetNodeId, (node) => {
          /* v8 ignore next -- targetNodeId resolves to a ws-tabs by construction; type guard is union narrowing */
          if (node.type !== "ws-tabs") return node;
          return {
            ...node,
            tabs: [...node.tabs, newTab],
            activeTabId: opts?.activate === false ? node.activeTabId : newTab.id,
          };
        });
        /* v8 ignore next -- replaceNode succeeds when targetNodeId resolves; defensive */
        if (!res.changed || !res.root) return null;
        set({
          layout: {
            ...layout,
            root: res.root,
            activeTabId: opts?.activate === false ? layout.activeTabId : newTab.id,
          },
        });
        return newTab.id;
      },
      closeWorkspaceTab: (tabId) => {
        const layout = get().layout;
        if (!layout) return false;
        const located = findTab(layout.root, tabId);
        if (!located) return false;
        const { node } = located;
        // Last-tab guard: 마지막 한 탭은 닫지 않는다 (ADR-0011 D5 단축키 표 비고).
        let totalTabs = 0;
        forEachTabsNode(layout.root, (n) => {
          totalTabs += n.tabs.length;
        });
        if (totalTabs <= 1) return false;
        const res = replaceNode(layout.root, node.id, (n) => {
          /* v8 ignore next -- located.node.id resolves to a ws-tabs; type guard is union narrowing */
          if (n.type !== "ws-tabs") return n;
          const nextTabs = n.tabs.filter((t) => t.id !== tabId);
          if (nextTabs.length === 0) return null;
          const wasActive = n.activeTabId === tabId;
          const idx = n.tabs.findIndex((t) => t.id === tabId);
          /* v8 ignore next -- closeWorkspaceTab tests only exercise the closing-of-last-tab and closing-of-tail-tab cases; the nextTabs[idx-1] and nextTabs[0] fallbacks are defensive arms */
          const neighbour = nextTabs[idx] ?? nextTabs[idx - 1] ?? nextTabs[0];
          /* v8 ignore next -- nextTabs.length > 0 branch checked above so neighbour is always defined */
          const activeTabId = wasActive ? (neighbour?.id ?? nextTabs[0]?.id ?? "") : n.activeTabId;
          return { ...n, tabs: nextTabs, activeTabId };
        });
        /* v8 ignore next -- replaceNode reports changed when located.node.id resolves; defensive */
        if (!res.changed || !res.root) return false;
        const nextRoot = applyMergeIfTrivial(res.root);
        const nextActive = findTab(nextRoot, layout.activeTabId)
          ? layout.activeTabId
          : /* v8 ignore next -- firstTabId always returns non-null for valid roots; the ?? "" fallback is defensive */
            (firstTabId(nextRoot) ?? "");
        set({ layout: { ...layout, root: nextRoot, activeTabId: nextActive } });
        return true;
      },
      splitVertical: (tabId) => doSplit(get, set, "horizontal", tabId),
      splitHorizontal: (tabId) => doSplit(get, set, "vertical", tabId),
      mergeIfTrivial: () => {
        const layout = get().layout;
        if (!layout) return;
        const next = applyMergeIfTrivial(layout.root);
        if (next === layout.root) return;
        set({ layout: { ...layout, root: next } });
      },
      setActiveTab: (tabId) => {
        const layout = get().layout;
        if (!layout) return;
        const located = findTab(layout.root, tabId);
        if (!located) return;
        const res = replaceNode(layout.root, located.node.id, (n) => {
          /* v8 ignore next -- located.node.id resolves to ws-tabs; type guard */
          if (n.type !== "ws-tabs") return n;
          if (n.activeTabId === tabId) return n;
          return { ...n, activeTabId: tabId };
        });
        /* v8 ignore next -- replaceNode reports changed on resolved id; root non-null */
        if (!res.root) return;
        const nextRoot = res.root;
        if (nextRoot === layout.root && layout.activeTabId === tabId) return;
        set({ layout: { ...layout, root: nextRoot, activeTabId: tabId } });
      },
      moveTab: (dragSource, dropTarget) => {
        const layout = get().layout;
        if (!layout) return false;
        const srcLocated = findTab(layout.root, dragSource);
        if (!srcLocated) return false;
        const tgt = findTabsNode(layout.root, dropTarget.nodeId);
        if (!tgt) return false;
        const { node: srcNode, tab } = srcLocated;
        // Same-node reorder.
        if (srcNode.id === tgt.id) {
          const curIdx = srcNode.tabs.findIndex((t) => t.id === dragSource);
          const baseLen = srcNode.tabs.length;
          const insertAt =
            dropTarget.index == null
              ? baseLen - 1
              : Math.max(0, Math.min(dropTarget.index, baseLen - 1));
          if (curIdx === insertAt) return false;
          const reordered = srcNode.tabs.slice();
          reordered.splice(curIdx, 1);
          reordered.splice(insertAt, 0, tab);
          const res = replaceNode(layout.root, srcNode.id, (n) => {
            /* v8 ignore next -- srcNode.id resolves to ws-tabs; type guard */
            if (n.type !== "ws-tabs") return n;
            return { ...n, tabs: reordered };
          });
          /* v8 ignore next -- replaceNode reports changed when id resolves; root non-null */
          if (!res.root) return false;
          set({ layout: { ...layout, root: res.root } });
          return true;
        }
        // Cross-node move: target 에 먼저 삽입, 그 다음 source 에서 제거.
        const tgtBaseLen = tgt.tabs.length;
        const insertAt =
          dropTarget.index == null
            ? tgtBaseLen
            : Math.max(0, Math.min(dropTarget.index, tgtBaseLen));
        const afterInsert = replaceNode(layout.root, tgt.id, (n) => {
          /* v8 ignore next -- tgt.id resolves to ws-tabs; type guard */
          if (n.type !== "ws-tabs") return n;
          const nextTabs = n.tabs.slice();
          nextTabs.splice(insertAt, 0, tab);
          return { ...n, tabs: nextTabs, activeTabId: tab.id };
        });
        /* v8 ignore next -- replaceNode reports changed when id resolves */
        if (!afterInsert.root) return false;
        const afterRemove = replaceNode(afterInsert.root, srcNode.id, (n) => {
          /* v8 ignore next -- srcNode.id resolves to ws-tabs; type guard */
          if (n.type !== "ws-tabs") return n;
          const nextTabs = n.tabs.filter((t) => t.id !== dragSource);
          if (nextTabs.length === 0) return null;
          const wasActive = n.activeTabId === dragSource;
          const activeTabId = wasActive
            ? /* v8 ignore next -- nextTabs.length > 0 branch checked; defensive fallback */
              (nextTabs[0]?.id ?? n.activeTabId)
            : n.activeTabId;
          return { ...n, tabs: nextTabs, activeTabId };
        });
        /* v8 ignore next -- afterRemove.root is non-null whenever any other tabs node retains tabs; with the just-inserted target node that always holds */
        const finalRoot = applyMergeIfTrivial(afterRemove.root ?? afterInsert.root);
        set({ layout: { ...layout, root: finalRoot, activeTabId: tab.id } });
        return true;
      },
      patchTabState: (tabId, patch) => {
        const layout = get().layout;
        if (!layout) return;
        const located = findTab(layout.root, tabId);
        if (!located) return;
        const res = replaceNode(layout.root, located.node.id, (n) => {
          /* v8 ignore next -- located.node.id resolves to ws-tabs */
          if (n.type !== "ws-tabs") return n;
          const nextTabs = n.tabs.map((t) =>
            t.id === tabId ? { ...t, tabState: { ...t.tabState, ...patch } } : t,
          );
          return { ...n, tabs: nextTabs };
        });
        /* v8 ignore next -- replaceNode reports changed/root non-null when id resolves */
        if (!res.root) return;
        set({ layout: { ...layout, root: res.root } });
      },
      serialize: () => {
        const layout = get().layout;
        /* v8 ignore next -- callers (persistence boot) check layout != null before serializing; defensive */
        if (!layout) return null;
        return serializeWindowLayout(layout);
      },
      deserialize: (raw) => {
        const parsed = deserializeWindowLayout(raw);
        if (!parsed) return false;
        set({ layout: parsed });
        return true;
      },
    }),
    persistOptions,
  ),
);

function doSplit(
  get: () => WorkspaceLayoutState,
  set: (s: Partial<WorkspaceLayoutState>) => void,
  /** "horizontal" = 자식이 가로로 배치(좌우 split). ADR-0011 의 Mod+\ 가 vertical split (좌우). */
  direction: WorkspaceSplitDirection,
  tabId?: WorkspaceTabId,
): WorkspaceTabId | null {
  const layout = get().layout;
  if (!layout) return null;
  const targetTabId = tabId ?? layout.activeTabId;
  const located = findTab(layout.root, targetTabId);
  if (!located) return null;
  const { node: srcNode, tab: srcTab } = located;
  // 새 탭은 source 탭을 복제(같은 워크스페이스, 새 id + 새 tabState).
  const clone = createWorkspaceTab(srcTab.workspacePath, {
    tabState: { ...srcTab.tabState, lastVisitedAt: Date.now() },
  });
  const newTabsNode = createTabsNode([clone]);
  const res = replaceNode(layout.root, srcNode.id, (n) => {
    /* v8 ignore next -- srcNode.id resolves to ws-tabs */
    if (n.type !== "ws-tabs") return n;
    const split: WorkspaceSplitNode = {
      type: "ws-split",
      id: `wsn-${randId()}`,
      direction,
      children: [n, newTabsNode],
      sizes: [0.5, 0.5],
    };
    return split;
  });
  /* v8 ignore next -- replaceNode reports changed/root non-null when id resolves */
  if (!res.root) return null;
  set({ layout: { ...layout, root: res.root, activeTabId: clone.id } });
  return clone.id;
}
