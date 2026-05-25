// S-MWS-003: 워크스페이스 탭 × 스플릿 셸 렌더러.
//
// ADR-0011 D1 의 두 단계 트리(`WorkspaceSplitNode` / `WorkspaceTabsNode`) 를
// 그대로 walk 한다. 각 `ws-tabs` leaf 는 자기만의 사이드바 + FileTree +
// EditorHost 를 가지며, 워크스페이스 탭별 상태(D2) 는 `WorkspaceTab.tabState`
// 가 가진다.
//
// 단일 탭/단일 스플릿 fast path 는 본 컴포넌트를 통과하지 않는다 — Main.tsx
// 가 별도 렌더 경로로 처리하므로 시각적 변화가 0 이다.

import { type ReactNode, useCallback, useMemo, useRef } from "react";
import {
  type WorkspaceLayoutNode,
  type WorkspaceSplitNode,
  type WorkspaceTab,
  type WorkspaceTabsNode,
  useWorkspaceLayout,
} from "../store/workspace-layout";

interface WorkspaceShellProps {
  /** 각 워크스페이스 탭의 body 렌더 (사이드바 + 에디터). 호출자가 주입. */
  renderTabBody: (tab: WorkspaceTab) => ReactNode;
}

export function WorkspaceShell({ renderTabBody }: WorkspaceShellProps) {
  const layout = useWorkspaceLayout((s) => s.layout);
  if (!layout) return null;
  return (
    <div data-workspace-shell="true" className="flex h-full w-full min-h-0 min-w-0 flex-1">
      <ShellNode node={layout.root} renderTabBody={renderTabBody} />
    </div>
  );
}

function ShellNode({
  node,
  renderTabBody,
}: {
  node: WorkspaceLayoutNode;
  renderTabBody: (tab: WorkspaceTab) => ReactNode;
}) {
  if (node.type === "ws-tabs") {
    return <TabsLeaf node={node} renderTabBody={renderTabBody} />;
  }
  return <SplitContainer node={node} renderTabBody={renderTabBody} />;
}

function SplitContainer({
  node,
  renderTabBody,
}: {
  node: WorkspaceSplitNode;
  renderTabBody: (tab: WorkspaceTab) => ReactNode;
}) {
  const isHorizontal = node.direction === "horizontal";
  const total = useMemo(
    /* v8 ignore next -- sizes seeded to 1-per-child at creation, so the `|| children.length` fallback is defensive */
    () => node.sizes.reduce((a, b) => a + b, 0) || node.children.length,
    [node.children.length, node.sizes],
  );
  return (
    <div
      data-ws-split-id={node.id}
      data-ws-split-direction={node.direction}
      className={
        isHorizontal
          ? "flex min-h-0 min-w-0 flex-1 flex-row"
          : "flex min-h-0 min-w-0 flex-1 flex-col"
      }
    >
      {node.children.map((child, idx) => {
        /* v8 ignore next -- sizes is sized to match children at creation; the `?? 1` fallback is unreachable */
        const ratio = (node.sizes[idx] ?? 1) / total;
        return (
          <ShellSlot
            key={child.id}
            child={child}
            renderTabBody={renderTabBody}
            split={node}
            childIdx={idx}
            flex={`${ratio} ${ratio} 0%`}
          />
        );
      })}
    </div>
  );
}

function ShellSlot({
  child,
  renderTabBody,
  childIdx,
  flex,
}: {
  child: WorkspaceLayoutNode;
  renderTabBody: (tab: WorkspaceTab) => ReactNode;
  split: WorkspaceSplitNode;
  childIdx: number;
  flex: string;
}) {
  const showHandle = childIdx > 0;
  return (
    <>
      {showHandle ? <SplitHandle /> : null}
      <div className="flex min-h-0 min-w-0 flex-col" style={{ flex }}>
        <ShellNode node={child} renderTabBody={renderTabBody} />
      </div>
    </>
  );
}

/**
 * 간단한 비-드래그 핸들 — 본 unit 의 첫 패스는 시각적 분할만 보장한다.
 * 실제 드래그 리사이즈는 후속 작업 (S-MWS-006) 으로 분리.
 */
function SplitHandle() {
  return (
    <div
      role="separator"
      tabIndex={-1}
      aria-hidden="true"
      className="w-1 shrink-0 bg-[var(--color-border)] hover:bg-[var(--color-accent)]"
    />
  );
}

function TabsLeaf({
  node,
  renderTabBody,
}: {
  node: WorkspaceTabsNode;
  renderTabBody: (tab: WorkspaceTab) => ReactNode;
}) {
  const setActiveTab = useWorkspaceLayout((s) => s.setActiveTab);
  const closeWorkspaceTab = useWorkspaceLayout((s) => s.closeWorkspaceTab);
  const activeId = node.activeTabId;
  const activeTab = useMemo(
    () => node.tabs.find((t) => t.id === activeId) ?? node.tabs[0],
    [node.tabs, activeId],
  );
  /* v8 ignore next -- ws-tabs is constructed with at least one tab; defensive guard */
  if (!activeTab) return null;
  return (
    <section
      data-ws-tabs-id={node.id}
      data-ws-active-tab-id={activeTab.id}
      className="flex min-h-0 min-w-0 flex-1 flex-col"
    >
      <TabStrip
        node={node}
        onActivate={(id) => setActiveTab(id)}
        onClose={(id) => closeWorkspaceTab(id)}
      />
      <div className="flex min-h-0 min-w-0 flex-1">{renderTabBody(activeTab)}</div>
    </section>
  );
}

function TabStrip({
  node,
  onActivate,
  onClose,
}: {
  node: WorkspaceTabsNode;
  onActivate: (id: string) => void;
  onClose: (id: string) => void;
}) {
  // ARIA tablist + drag handle 자리. 현 패스는 클릭/닫기만 노출.
  const stripRef = useRef<HTMLDivElement | null>(null);
  const onTabClick = useCallback((id: string) => () => onActivate(id), [onActivate]);
  const onTabClose = useCallback(
    (id: string) => (evt: React.MouseEvent) => {
      evt.stopPropagation();
      onClose(id);
    },
    [onClose],
  );
  return (
    <div
      ref={stripRef}
      role="tablist"
      aria-label="Workspace tabs"
      data-ws-tab-strip="true"
      className="flex shrink-0 items-stretch overflow-x-auto border-[var(--color-border)] border-b bg-[var(--color-surface-subtle)] text-xs"
    >
      {node.tabs.map((tab) => {
        const active = tab.id === node.activeTabId;
        const label = labelForPath(tab.workspacePath);
        return (
          <div
            key={tab.id}
            role="tab"
            tabIndex={0}
            aria-selected={active}
            data-ws-tab-id={tab.id}
            onClick={onTabClick(tab.id)}
            onKeyDown={(e) => {
              if (e.key === "Enter" || e.key === " ") {
                e.preventDefault();
                onActivate(tab.id);
              }
            }}
            className={
              active
                ? "flex shrink-0 cursor-pointer items-center gap-2 border-[var(--color-accent)] border-b-2 px-3 py-1 font-medium text-[var(--color-fg)]"
                : "flex shrink-0 cursor-pointer items-center gap-2 border-transparent border-b-2 px-3 py-1 text-[var(--color-muted)] hover:text-[var(--color-fg)]"
            }
            title={tab.workspacePath}
          >
            <span className="truncate">{label}</span>
            <button
              type="button"
              aria-label="Close tab"
              data-ws-tab-close="true"
              onClick={onTabClose(tab.id)}
              onKeyDown={(e) => {
                if (e.key === "Enter" || e.key === " ") {
                  e.stopPropagation();
                  e.preventDefault();
                  onClose(tab.id);
                }
              }}
              className="cursor-pointer rounded px-1 text-[var(--color-muted)] hover:bg-[var(--color-surface)] hover:text-[var(--color-fg)]"
            >
              ×
            </button>
          </div>
        );
      })}
    </div>
  );
}

function labelForPath(path: string): string {
  const trimmed = path.replace(/[/\\]+$/, "");
  /* v8 ignore next -- split on `/` always yields a non-empty array; pop()'s undefined fallback is defensive */
  const tail = trimmed.split(/[/\\]/).pop() ?? trimmed;
  /* v8 ignore next -- empty-tail fallback only fires for root-only paths like "/" after trim, defensive */
  return tail || trimmed;
}
