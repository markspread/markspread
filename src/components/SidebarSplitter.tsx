import { useCallback, useEffect, useRef } from "react";
import { useTranslation } from "react-i18next";
import {
  SIDEBAR_MAX_PX,
  SIDEBAR_MIN_PX,
  clampSidebarWidth,
  useLayout,
} from "../store/layout";

interface Props {
  workspace: string;
  containerRef: React.RefObject<HTMLElement | null>;
}

/**
 * S-FT-020: 4px draggable handle between the FileTree and the editor pane.
 * Pointer events handle mouse + touch + pen uniformly, and we capture the
 * pointer so the drag survives quick movements outside the handle.
 *
 * Width is read from the workspace-keyed layout store, so multi-window
 * layouts and per-project preferences persist independently.
 */
export function SidebarSplitter({ workspace, containerRef }: Props) {
  const { t } = useTranslation();
  const width = useLayout((s) => s.getSidebarWidth(workspace));
  const setWidth = useLayout((s) => s.setSidebarWidth);
  const startX = useRef(0);
  const startWidth = useRef(width);

  const onPointerDown = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      e.preventDefault();
      e.currentTarget.setPointerCapture(e.pointerId);
      startX.current = e.clientX;
      startWidth.current = width;
    },
    [width],
  );

  const onPointerMove = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      if (!e.currentTarget.hasPointerCapture(e.pointerId)) return;
      const delta = e.clientX - startX.current;
      // Constrain against the container so the splitter can't push past the
      // editor minimum either — leave at least 240px for the editor pane.
      const containerWidth =
        containerRef.current?.getBoundingClientRect().width ?? Infinity;
      const editorMin = 240;
      const upper = Math.min(SIDEBAR_MAX_PX, containerWidth - editorMin);
      const next = clampSidebarWidth(startWidth.current + delta);
      setWidth(workspace, Math.min(next, upper));
    },
    [containerRef, setWidth, workspace],
  );

  const onPointerUp = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      if (e.currentTarget.hasPointerCapture(e.pointerId)) {
        e.currentTarget.releasePointerCapture(e.pointerId);
      }
    },
    [],
  );

  // Keyboard nudge: ←/→ adjust by 8px, Shift for 32px. Home/End jump to bounds.
  const onKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLDivElement>) => {
      let next = width;
      const step = e.shiftKey ? 32 : 8;
      if (e.key === "ArrowLeft") next = width - step;
      else if (e.key === "ArrowRight") next = width + step;
      else if (e.key === "Home") next = SIDEBAR_MIN_PX;
      else if (e.key === "End") next = SIDEBAR_MAX_PX;
      else return;
      e.preventDefault();
      setWidth(workspace, next);
    },
    [setWidth, width, workspace],
  );

  // Repair any persisted out-of-range value on mount (defensive — the store
  // already clamps, but this surfaces a stale persisted default if max
  // changes in a future release).
  useEffect(() => {
    const clamped = clampSidebarWidth(width);
    if (clamped !== width) setWidth(workspace, clamped);
  }, [setWidth, width, workspace]);

  return (
    <div
      role="separator"
      aria-orientation="vertical"
      aria-valuenow={width}
      aria-valuemin={SIDEBAR_MIN_PX}
      aria-valuemax={SIDEBAR_MAX_PX}
      aria-label={t("layout.aria.sidebar_resize", "Resize sidebar")}
      tabIndex={0}
      className="w-1 shrink-0 cursor-col-resize touch-none bg-[var(--color-border)] hover:bg-[var(--color-accent)] focus-visible:bg-[var(--color-accent)] focus-visible:outline-none"
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerUp}
      onKeyDown={onKeyDown}
    />
  );
}
