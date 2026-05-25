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
  type WorkspaceTabsNode,
  findTab,
  forEachTabsNode,
  useWorkspaceLayout,
} from "../store/workspace-layout";

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

/**
 * 등록만 하고 자동 정리. App.tsx 의 RealApp 에 단 한 번 마운트한다.
 */
export function useWorkspaceShellShortcuts(): void {
  useEffect(() => {
    const handler = (evt: KeyboardEvent) => {
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
