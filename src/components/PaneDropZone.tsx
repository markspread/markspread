// S-ESP-004: tab-into-pane drop overlay.
//
// The overlay sits absolutely positioned inside a PaneNode container and only
// becomes interactive while a tab is being dragged (`isActive`). It splits the
// pane surface into 5 regions:
//   - center  → drop merges the tab into this pane
//   - left    → split horizontally, new pane on the left
//   - right   → split horizontally, new pane on the right
//   - top     → split vertically, new pane on top
//   - bottom  → split vertically, new pane on bottom
//
// The hovered region is highlighted with a translucent accent overlay so the
// outcome is obvious before the user releases.

import { useState } from "react";
import { type SplitSide, useEditorLayout } from "../store/editor-layout";
import type { PaneId, SplitDirection, TabId } from "../lib/editor/layout-model";

export const TAB_DRAG_MIME = "application/x-markspread-pane-tab";

export interface TabDragPayload {
  fromPaneId: PaneId;
  tabId: TabId;
}

export type DropRegion = "center" | "left" | "right" | "top" | "bottom";

interface PaneDropZoneProps {
  workspace: string;
  paneId: PaneId;
  /** Bag of currently-being-dragged metadata (read from window or a context). */
  isActive: boolean;
}

/** Geometry: 30% strips on each edge, center is everything else. */
export function regionForPoint(
  x: number,
  y: number,
  rect: { left: number; top: number; width: number; height: number },
): DropRegion {
  const dx = (x - rect.left) / rect.width;
  const dy = (y - rect.top) / rect.height;
  const edge = 0.3;
  // Diagonals: pick the dominant axis so corners feel deterministic.
  const distLeft = dx;
  const distRight = 1 - dx;
  const distTop = dy;
  const distBottom = 1 - dy;
  const min = Math.min(distLeft, distRight, distTop, distBottom);
  if (min > edge) return "center";
  if (min === distLeft) return "left";
  if (min === distRight) return "right";
  if (min === distTop) return "top";
  return "bottom";
}

function regionToSplit(
  region: DropRegion,
): { direction: SplitDirection; side: SplitSide } | null {
  switch (region) {
    case "left":
      return { direction: "horizontal", side: "before" };
    case "right":
      return { direction: "horizontal", side: "after" };
    case "top":
      return { direction: "vertical", side: "before" };
    case "bottom":
      return { direction: "vertical", side: "after" };
    case "center":
      return null;
  }
}

export function PaneDropZone({ workspace, paneId, isActive }: PaneDropZoneProps) {
  const moveTab = useEditorLayout((s) => s.moveTab);
  const splitWithTab = useEditorLayout((s) => s.splitWithTab);
  const [region, setRegion] = useState<DropRegion | null>(null);

  if (!isActive) return null;

  return (
    <div
      aria-hidden="true"
      data-pane-drop-zone={paneId}
      className="pointer-events-auto absolute inset-0"
      onDragOver={(e) => {
        if (!e.dataTransfer.types.includes(TAB_DRAG_MIME)) return;
        e.preventDefault();
        e.dataTransfer.dropEffect = "move";
        const rect = e.currentTarget.getBoundingClientRect();
        setRegion(regionForPoint(e.clientX, e.clientY, rect));
      }}
      onDragLeave={(e) => {
        if (!(e.relatedTarget instanceof Node) || !e.currentTarget.contains(e.relatedTarget)) {
          setRegion(null);
        }
      }}
      onDrop={(e) => {
        const raw = e.dataTransfer.getData(TAB_DRAG_MIME);
        setRegion(null);
        if (!raw) return;
        let payload: TabDragPayload;
        try {
          payload = JSON.parse(raw) as TabDragPayload;
        } catch {
          return;
        }
        if (!payload?.fromPaneId || !payload?.tabId) return;
        e.preventDefault();
        const rect = e.currentTarget.getBoundingClientRect();
        const r = regionForPoint(e.clientX, e.clientY, rect);
        const split = regionToSplit(r);
        if (split) {
          splitWithTab(
            workspace,
            payload.fromPaneId,
            payload.tabId,
            paneId,
            split.direction,
            split.side,
          );
        } else {
          moveTab(workspace, payload.fromPaneId, payload.tabId, paneId, null);
        }
      }}
    >
      {region ? <DropHint region={region} /> : null}
    </div>
  );
}

function DropHint({ region }: { region: DropRegion }) {
  const style = regionStyle(region);
  return (
    <span
      aria-hidden="true"
      className="absolute bg-[var(--color-accent)]/30 ring-2 ring-[var(--color-accent)] ring-inset"
      style={style}
    />
  );
}

function regionStyle(region: DropRegion): React.CSSProperties {
  switch (region) {
    case "center":
      return { inset: 0 };
    case "left":
      return { top: 0, bottom: 0, left: 0, width: "50%" };
    case "right":
      return { top: 0, bottom: 0, right: 0, width: "50%" };
    case "top":
      return { top: 0, left: 0, right: 0, height: "50%" };
    case "bottom":
      return { bottom: 0, left: 0, right: 0, height: "50%" };
  }
}
