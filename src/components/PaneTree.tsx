// S-ESP-003: recursive renderer for the WorkspaceLayout tree.
//
// Walks LayoutNode and emits nested flex containers. Each PaneNode renders
// `renderPane()` (the caller plugs in TabBar + EditorPane); split nodes get
// PaneSplitter handles between children with drag-to-resize and min-size
// constraints (PANE_MIN_WIDTH_PX / PANE_MIN_HEIGHT_PX).

import { useCallback, useRef } from "react";
import type { LayoutNode, PaneNode, SplitNode } from "../lib/editor/layout-model";
import { PANE_MIN_HEIGHT_PX, PANE_MIN_WIDTH_PX, useEditorLayout } from "../store/editor-layout";

interface PaneTreeProps {
  workspace: string;
  node: LayoutNode;
  renderPane: (pane: PaneNode) => React.ReactNode;
}

export function PaneTree({ workspace, node, renderPane }: PaneTreeProps) {
  if (node.type === "pane") {
    return (
      <div data-pane-id={node.id} className="flex min-h-0 min-w-0 flex-1 flex-col">
        {renderPane(node)}
      </div>
    );
  }
  return <SplitView workspace={workspace} node={node} renderPane={renderPane} />;
}

function SplitView({
  workspace,
  node,
  renderPane,
}: {
  workspace: string;
  node: SplitNode;
  renderPane: (pane: PaneNode) => React.ReactNode;
}) {
  const total = node.sizes.reduce((a, b) => a + b, 0) || node.children.length;
  const isHorizontal = node.direction === "horizontal";
  return (
    <div
      data-split-id={node.id}
      data-split-direction={node.direction}
      className={
        isHorizontal
          ? "flex min-h-0 min-w-0 flex-1 flex-row"
          : "flex min-h-0 min-w-0 flex-1 flex-col"
      }
    >
      {node.children.map((child, idx) => {
        const ratio = (node.sizes[idx] ?? 1) / total;
        const flex = `${ratio} ${ratio} 0%`;
        return (
          <PaneSlot
            key={child.id}
            workspace={workspace}
            split={node}
            childIdx={idx}
            child={child}
            renderPane={renderPane}
            flex={flex}
          />
        );
      })}
    </div>
  );
}

function PaneSlot({
  workspace,
  split,
  childIdx,
  child,
  renderPane,
  flex,
}: {
  workspace: string;
  split: SplitNode;
  childIdx: number;
  child: LayoutNode;
  renderPane: (pane: PaneNode) => React.ReactNode;
  flex: string;
}) {
  const showSplitter = childIdx > 0;
  return (
    <>
      {showSplitter ? (
        <PaneSplitter workspace={workspace} split={split} beforeIdx={childIdx - 1} />
      ) : null}
      <div className="flex min-h-0 min-w-0 flex-col" style={{ flex }}>
        <PaneTree workspace={workspace} node={child} renderPane={renderPane} />
      </div>
    </>
  );
}

/**
 * Drag handle between split children. Resizes the two adjacent children by
 * shifting their `sizes` proportionally; min-size constraints in pixels are
 * enforced against the parent split's measured DOM width/height so the user
 * can never collapse a pane below its readable minimum.
 */
function PaneSplitter({
  workspace,
  split,
  beforeIdx,
}: {
  workspace: string;
  split: SplitNode;
  beforeIdx: number;
}) {
  const setSizes = useEditorLayout((s) => s.setSizes);
  const handleRef = useRef<HTMLDivElement | null>(null);
  const startPx = useRef(0);
  const startSizes = useRef<number[]>([]);
  const totalPx = useRef(0);
  const isHorizontal = split.direction === "horizontal";

  const onPointerDown = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      e.preventDefault();
      e.currentTarget.setPointerCapture(e.pointerId);
      startPx.current = isHorizontal ? e.clientX : e.clientY;
      startSizes.current = split.sizes.slice();
      const parent = handleRef.current?.parentElement;
      const rect = parent?.getBoundingClientRect();
      totalPx.current = (isHorizontal ? rect?.width : rect?.height) ?? 0;
    },
    [isHorizontal, split.sizes],
  );

  const onPointerMove = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      if (!e.currentTarget.hasPointerCapture(e.pointerId)) return;
      if (totalPx.current <= 0) return;
      const delta = (isHorizontal ? e.clientX : e.clientY) - startPx.current;
      const deltaRatio = delta / totalPx.current;
      const sizes = startSizes.current.slice();
      const a = sizes[beforeIdx] ?? 0;
      const b = sizes[beforeIdx + 1] ?? 0;
      const minRatio = (isHorizontal ? PANE_MIN_WIDTH_PX : PANE_MIN_HEIGHT_PX) / totalPx.current;
      let nextA = a + deltaRatio;
      let nextB = b - deltaRatio;
      if (nextA < minRatio) {
        nextA = minRatio;
        nextB = a + b - minRatio;
      }
      if (nextB < minRatio) {
        nextB = minRatio;
        nextA = a + b - minRatio;
      }
      sizes[beforeIdx] = nextA;
      sizes[beforeIdx + 1] = nextB;
      setSizes(workspace, split.id, sizes);
    },
    [beforeIdx, isHorizontal, setSizes, split.id, workspace],
  );

  const onPointerUp = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    if (e.currentTarget.hasPointerCapture(e.pointerId)) {
      e.currentTarget.releasePointerCapture(e.pointerId);
    }
  }, []);

  return (
    <div
      ref={handleRef}
      role="separator"
      tabIndex={0}
      aria-orientation={isHorizontal ? "vertical" : "horizontal"}
      className={
        isHorizontal
          ? "w-1 shrink-0 cursor-col-resize touch-none bg-[var(--color-border)] hover:bg-[var(--color-accent)]"
          : "h-1 shrink-0 cursor-row-resize touch-none bg-[var(--color-border)] hover:bg-[var(--color-accent)]"
      }
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerUp}
    />
  );
}
