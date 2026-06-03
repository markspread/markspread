// S-MWS-004: 워크스페이스 셸(워크스페이스 탭 × 스플릿) 단축키.
//
// ADR-0011 D5 의 키 표를 본 hook 이 등록한다. 기존 ADR-0003 페인 단축키와의
// 충돌은 D7 정책 — 분할이 없으면 (`root.type === "ws-tabs"`) Mod+1..9 는
// ADR-0003 의 페인 점프 의미를 그대로 유지, 분할이 있으면 워크스페이스 탭
// 점프로 의미가 바뀐다.
//
// IME 처리는 `lib/keybindings/ime` 의 `isComposing` 을 따로 부르지 않는다 —
// 셸 단축키는 모두 Mod+ 가 prefix 라 IME 의 KeyboardEvent 는 Mod 가 빠진다.

import { useEffect } from "react";
import { useWorkspace } from "../store/workspace";
import {
  type WorkspaceLayoutNode,
  type WorkspaceTabsNode,
  findTab,
  forEachTabsNode,
  useWorkspaceLayout,
} from "../store/workspace-layout";

// ADR-0019 §Decision.1: single Workspace shell — the chat/editor scope
// gate is gone. These workspace tab × split shortcuts are active
// whenever a workspace is open (and harmless on the Welcome screen,
// where `current` is null but no layout exists to act on either).
function isWorkspaceScopeActive(): boolean {
  return Boolean(useWorkspace.getState().current);
}

const isMac = () =>
  typeof navigator !== "undefined" && navigator.platform.toLowerCase().includes("mac");

function hasMod(evt: KeyboardEvent): boolean {
  return isMac() ? evt.metaKey : evt.ctrlKey;
}

function onlyMod(evt: KeyboardEvent): boolean {
  return hasMod(evt) && !evt.shiftKey && !evt.altKey;
}

function modShift(evt: KeyboardEvent): boolean {
  return hasMod(evt) && evt.shiftKey && !evt.altKey;
}

function modAlt(evt: KeyboardEvent): boolean {
  return hasMod(evt) && evt.altKey && !evt.shiftKey;
}

/**
 * Visual rectangle of an `ws-tabs` leaf in the split tree, in unit space
 * (0..1 along each axis). Built by recursively partitioning the unit
 * square by each `ws-split` node's `sizes` array.
 */
export interface LeafRect {
  nodeId: string;
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

/**
 * Walk the tree and emit a `LeafRect` per `ws-tabs` leaf. The rectangle
 * carries no pixel scale — it's purely topological, suitable for picking
 * the nearest neighbour in a cardinal direction (D5 nav semantics).
 */
export function computeLeafRects(root: WorkspaceLayoutNode): LeafRect[] {
  const out: LeafRect[] = [];
  const visit = (node: WorkspaceLayoutNode, x0: number, y0: number, x1: number, y1: number) => {
    if (node.type === "ws-tabs") {
      out.push({ nodeId: node.id, x0, y0, x1, y1 });
      return;
    }
    /* v8 ignore next -- sizes are seeded > 0 at split creation; the `|| children.length` fallback is defensive against pathological 0-sum inputs */
    const total = node.sizes.reduce((a, b) => a + b, 0) || node.children.length;
    let cursor = node.direction === "horizontal" ? x0 : y0;
    for (let i = 0; i < node.children.length; i += 1) {
      const child = node.children[i];
      /* v8 ignore next -- bounded loop; sizes length matches children length */
      if (!child) continue;
      /* v8 ignore next -- sizes seeded > 0 at split creation; defensive */
      const ratio = (node.sizes[i] ?? 1) / total;
      if (node.direction === "horizontal") {
        const next = cursor + (x1 - x0) * ratio;
        visit(child, cursor, y0, next, y1);
        cursor = next;
      } else {
        const next = cursor + (y1 - y0) * ratio;
        visit(child, x0, cursor, x1, next);
        cursor = next;
      }
    }
  };
  visit(root, 0, 0, 1, 1);
  return out;
}

export type FocusDirection = "up" | "down" | "left" | "right";

/**
 * Pick the nearest neighbour leaf in the given direction. Returns null
 * when no leaf overlaps the perpendicular range or no leaf lies on the
 * requested side (e.g. "up" from the topmost row).
 */
export function pickNeighbourLeaf(
  rects: readonly LeafRect[],
  activeId: string,
  dir: FocusDirection,
): LeafRect | null {
  const active = rects.find((r) => r.nodeId === activeId);
  if (!active) return null;
  const candidates = rects.filter((r) => r.nodeId !== activeId);
  // Direction-axis filter: must be on the correct side of `active`.
  const onSide = candidates.filter((r) => {
    if (dir === "left") return r.x1 <= active.x0 + 1e-6;
    if (dir === "right") return r.x0 >= active.x1 - 1e-6;
    if (dir === "up") return r.y1 <= active.y0 + 1e-6;
    return r.y0 >= active.y1 - 1e-6;
  });
  // Perpendicular-axis filter: ranges must overlap.
  const overlapping = onSide.filter((r) => {
    if (dir === "left" || dir === "right") {
      return Math.min(active.y1, r.y1) - Math.max(active.y0, r.y0) > 1e-6;
    }
    return Math.min(active.x1, r.x1) - Math.max(active.x0, r.x0) > 1e-6;
  });
  if (overlapping.length === 0) return null;
  // Closest along the direction axis wins; ties broken by perpendicular
  // overlap span (larger overlap is preferred).
  overlapping.sort((a, b) => {
    const da =
      dir === "left"
        ? active.x0 - a.x1
        : dir === "right"
          ? a.x0 - active.x1
          : dir === "up"
            ? active.y0 - a.y1
            : a.y0 - active.y1;
    const db =
      dir === "left"
        ? active.x0 - b.x1
        : dir === "right"
          ? b.x0 - active.x1
          : dir === "up"
            ? active.y0 - b.y1
            : b.y0 - active.y1;
    /* v8 ignore next -- tie-break-only fork; the `≤ 1e-6` arm is exercised by the explicit tie tests, the `>` arm by the 2x2 grid scenarios */
    if (Math.abs(da - db) > 1e-6) return da - db;
    const oa =
      dir === "left" || dir === "right"
        ? Math.min(active.y1, a.y1) - Math.max(active.y0, a.y0)
        : Math.min(active.x1, a.x1) - Math.max(active.x0, a.x0);
    const ob =
      dir === "left" || dir === "right"
        ? Math.min(active.y1, b.y1) - Math.max(active.y0, b.y0)
        : Math.min(active.x1, b.x1) - Math.max(active.x0, b.x0);
    return ob - oa;
  });
  /* v8 ignore next -- overlapping.length === 0 short-circuits above; `?? null` is defensive */
  return overlapping[0] ?? null;
}

const ARROW_DIRS: Record<string, FocusDirection> = {
  arrowleft: "left",
  arrowright: "right",
  arrowup: "up",
  arrowdown: "down",
};

/**
 * Public entrypoint for command-palette / programmatic split focus
 * navigation. Returns true if focus moved, false if no neighbour exists
 * in that direction.
 */
export function focusSplitInDirection(dir: FocusDirection): boolean {
  const store = useWorkspaceLayout.getState();
  const layout = store.layout;
  if (!layout) return false;
  if (layout.root.type !== "ws-split") return false;
  const located = findTab(layout.root, layout.activeTabId);
  if (!located) return false;
  const rects = computeLeafRects(layout.root);
  const next = pickNeighbourLeaf(rects, located.node.id, dir);
  if (!next) return false;
  let targetTabId: string | null = null;
  forEachTabsNode(layout.root, (n) => {
    if (n.id === next.nodeId) {
      targetTabId = n.activeTabId;
      return false;
    }
  });
  /* v8 ignore next -- next.nodeId always resolves to a ws-tabs in the same layout; defensive */
  if (!targetTabId) return false;
  store.setActiveTab(targetTabId);
  return true;
}

/**
 * 등록만 하고 자동 정리. App.tsx 의 RealApp 에 단 한 번 마운트한다.
 */
export function useWorkspaceShellShortcuts(): void {
  useEffect(() => {
    const handler = (evt: KeyboardEvent) => {
      // ADR-0019: scope gate — these bindings act only when a workspace
      // is open. (The `!layout` guard below covers the rest.)
      if (!isWorkspaceScopeActive()) return;
      // 키 비교는 소문자 normalisation. `\` 는 evt.key 자체로 매칭 (shift 시 `|`).
      const key = evt.key.toLowerCase();
      const store = useWorkspaceLayout.getState();
      const layout = store.layout;
      // 레이아웃이 없는 시점(워크스페이스 미오픈)에는 셸 단축키 자체가 의미 없음.
      if (!layout) return;

      // Mod+T — 새 워크스페이스 탭. ADR-0011 D5: 현재는 active workspace 의
      // 경로를 그대로 복제해 새 탭을 만든다. 최근 워크스페이스 픽커는 별도 작업.
      if (onlyMod(evt) && key === "t") {
        const active = findTab(layout.root, layout.activeTabId);
        if (!active) return;
        evt.preventDefault();
        store.addWorkspaceTab(active.tab.workspacePath);
        return;
      }

      // Mod+W — active 워크스페이스 탭 닫기. 마지막 탭이면 protected (store 가 false 반환).
      if (onlyMod(evt) && key === "w") {
        evt.preventDefault();
        const closed = store.closeWorkspaceTab(layout.activeTabId);
        // 닫기에 실패하고 (마지막 탭) 단 한 개의 탭만 남았다면 워크스페이스도 비운다.
        if (!closed) {
          useWorkspace.getState().close();
        }
        return;
      }

      // Mod+\ — 세로 분할 (좌우). evt.key 가 "\" 인지 평가.
      if (onlyMod(evt) && evt.key === "\\") {
        evt.preventDefault();
        store.splitVertical();
        return;
      }

      // Mod+Shift+\ — 가로 분할 (상하).
      if (modShift(evt) && (evt.key === "\\" || evt.key === "|")) {
        evt.preventDefault();
        store.splitHorizontal();
        return;
      }

      // Mod+Alt+Arrow — 인접 워크스페이스 스플릿으로 포커스 이동 (MAR-1015).
      // ADR-0011 D5: macOS/브라우저의 Mod+Arrow 와 충돌하지 않도록 Alt 동반.
      // root 가 단일 ws-tabs 일 땐 통과 (분할 없음).
      if (modAlt(evt)) {
        const dir = ARROW_DIRS[key];
        if (dir) {
          if (layout.root.type !== "ws-split") return;
          const moved = focusSplitInDirection(dir);
          if (moved) evt.preventDefault();
          return;
        }
      }

      // Mod+1..9 — active 스플릿의 n 번째 워크스페이스 탭으로 점프.
      // D7: 분할이 없으면 (root === ws-tabs) ADR-0003 의 페인 점프로 폴백 —
      // 본 hook 은 그 경우 preventDefault 하지 않고 통과시켜 다른 핸들러가 처리.
      if (onlyMod(evt) && /^[1-9]$/.test(key)) {
        if (layout.root.type === "ws-tabs") return;
        const idx = Number.parseInt(key, 10) - 1;
        const activeNode = findTab(layout.root, layout.activeTabId)?.node;
        if (!activeNode) return;
        const tab = activeNode.tabs[idx];
        if (!tab) return;
        evt.preventDefault();
        store.setActiveTab(tab.id);
        return;
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, []);
}

/**
 * Test helper: 활성 워크스페이스 탭이 속한 ws-tabs 노드의 탭 수.
 * `useWorkspaceShellShortcuts` 가 noop 인지 판단할 때 활용.
 */
export function activeTabsNodeSize(): number {
  const layout = useWorkspaceLayout.getState().layout;
  if (!layout) return 0;
  let size = 0;
  forEachTabsNode(layout.root, (n: WorkspaceTabsNode) => {
    if (n.tabs.some((t) => t.id === layout.activeTabId)) {
      size = n.tabs.length;
      return false;
    }
  });
  return size;
}
