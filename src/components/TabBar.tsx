// S-ESP-002: tab strip with VSCode-style interactions —
//   - drag-to-reorder (HTML5 dnd; pane-to-pane drop lands with F4
//     S-ESP-004 once the multi-pane shell exists)
//   - middle-click closes a tab
//   - double-click on a preview tab promotes it to permanent
//   - pinned tabs sort to the left of the strip and stay there
//   - hover-only close button so the bar stays clean at rest
//
// The bar runs in one of two modes:
//   - pane mode: `pane` prop drives the strip; mutations go through
//     `useEditorLayout` so two panes can show different tab sets.
//   - legacy mode (no `pane`): falls back to the flat `useTabs` store
//     so single-file / pre-F4 flows still work during migration.

import { memo, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import type { PaneNode, PaneTab } from "../lib/editor/layout-model";
import { useEditorLayout } from "../store/editor-layout";
import { type OpenTab, useTabs } from "../store/tabs";

interface TabBarProps {
  workspace: string;
  pane?: PaneNode;
}

interface DisplayTab {
  key: string;
  path: string;
  pinned: boolean;
  preview: boolean;
  dirty: boolean;
  orphaned: boolean;
}

function basename(p: string): string {
  const idx = Math.max(p.lastIndexOf("/"), p.lastIndexOf("\\"));
  return idx >= 0 ? p.slice(idx + 1) : p;
}

const DRAG_MIME = "application/x-markspread-tab";

interface DropHint {
  key: string;
  before: boolean;
}

function toDisplay(tab: OpenTab | PaneTab, isPane: boolean): DisplayTab {
  return {
    key: isPane ? (tab as PaneTab).id : tab.path,
    path: tab.path,
    pinned: tab.pinned ?? false,
    preview: tab.preview ?? false,
    dirty: tab.dirty ?? false,
    orphaned: tab.orphaned ?? false,
  };
}

export const TabBar = memo(function TabBar({ workspace, pane }: TabBarProps) {
  const { t } = useTranslation();
  const legacyTabs = useTabs((s) => s.tabs);
  const legacyActivePath = useTabs((s) => s.activePath);
  const legacySetActive = useTabs((s) => s.setActive);
  const legacyClose = useTabs((s) => s.close);
  const legacyPin = useTabs((s) => s.pin);
  const legacyUnpin = useTabs((s) => s.unpin);
  const legacyReorder = useTabs((s) => s.reorder);

  const wsPrefix = useMemo(() => workspace.replace(/[/\\]+$/, ""), [workspace]);
  const [dropHint, setDropHint] = useState<DropHint | null>(null);

  // Build the ordered display list. Pane mode walks pane.tabs; legacy
  // mode walks useTabs.tabs. Pinned tabs go first in either case.
  const ordered = useMemo<DisplayTab[]>(() => {
    const source: (OpenTab | PaneTab)[] = pane ? pane.tabs : legacyTabs;
    const display = source.map((tab) => toDisplay(tab, !!pane));
    const pinned = display.filter((d) => d.pinned);
    const rest = display.filter((d) => !d.pinned);
    return [...pinned, ...rest];
  }, [pane, legacyTabs]);

  if (ordered.length === 0) return null;

  const isActive = (d: DisplayTab) =>
    pane ? d.key === pane.activeTabId : d.path === legacyActivePath;

  const onSelect = (d: DisplayTab) => {
    if (pane) useEditorLayout.getState().setActiveTab(workspace, pane.id, d.key);
    else legacySetActive(d.path);
  };

  const onClose = (d: DisplayTab) => {
    if (pane) useEditorLayout.getState().closeTab(workspace, pane.id, d.key);
    else legacyClose(d.path);
  };

  const onTogglePin = (d: DisplayTab) => {
    if (pane) useEditorLayout.getState().setTabPinned(workspace, pane.id, d.key, !d.pinned);
    else if (d.pinned) legacyUnpin(d.path);
    else legacyPin(d.path);
  };

  const onPromotePreview = (d: DisplayTab) => {
    if (!d.preview) return;
    if (pane) useEditorLayout.getState().setTabPinned(workspace, pane.id, d.key, true);
    else legacyPin(d.path);
  };

  const onReorder = (srcKey: string, targetKey: string, before: boolean) => {
    if (pane) {
      const srcIdx = pane.tabs.findIndex((tab) => tab.id === srcKey);
      const tgtIdx = pane.tabs.findIndex((tab) => tab.id === targetKey);
      if (srcIdx < 0 || tgtIdx < 0) return;
      const at = before ? tgtIdx : tgtIdx + 1;
      useEditorLayout.getState().moveTab(workspace, pane.id, srcKey, pane.id, at);
    } else {
      legacyReorder(srcKey, targetKey, before);
    }
  };

  return (
    <div
      className="flex shrink-0 items-stretch overflow-x-auto border-[var(--color-border)] border-b bg-[var(--color-surface-subtle)] text-xs"
      role="tablist"
      aria-label={t("tabs.aria.bar", "Open files")}
      onDragLeave={(e) => {
        if (!(e.relatedTarget instanceof Node) || !e.currentTarget.contains(e.relatedTarget)) {
          setDropHint(null);
        }
      }}
    >
      {ordered.map((tab) => {
        const active = isActive(tab);
        const rel =
          tab.path.startsWith(`${wsPrefix}/`) || tab.path.startsWith(`${wsPrefix}\\`)
            ? tab.path.slice(wsPrefix.length + 1)
            : tab.path;
        const isDropBefore = dropHint?.key === tab.key && dropHint.before;
        const isDropAfter = dropHint?.key === tab.key && !dropHint.before;
        return (
          <div
            key={tab.key}
            role="tab"
            aria-selected={active}
            title={tab.path}
            draggable
            data-tab-path={tab.path}
            className={`group relative flex shrink-0 items-center gap-1 border-[var(--color-border)] border-r px-3 py-1.5 cursor-pointer ${
              active
                ? "bg-[var(--color-surface-bg)] text-[var(--color-fg)]"
                : "text-[var(--color-muted)] hover:text-[var(--color-fg)]"
            } ${tab.preview ? "italic" : ""}`}
            onClick={() => onSelect(tab)}
            onAuxClick={(e) => {
              if (e.button === 1) {
                e.preventDefault();
                onClose(tab);
              }
            }}
            onDoubleClick={() => onPromotePreview(tab)}
            onDragStart={(e) => {
              e.dataTransfer.effectAllowed = "move";
              e.dataTransfer.setData(DRAG_MIME, tab.key);
            }}
            onDragOver={(e) => {
              if (!e.dataTransfer.types.includes(DRAG_MIME)) return;
              e.preventDefault();
              e.dataTransfer.dropEffect = "move";
              const rect = e.currentTarget.getBoundingClientRect();
              const before = e.clientX < rect.left + rect.width / 2;
              setDropHint({ key: tab.key, before });
            }}
            onDrop={(e) => {
              const src = e.dataTransfer.getData(DRAG_MIME);
              setDropHint(null);
              if (!src || src === tab.key) return;
              e.preventDefault();
              const rect = e.currentTarget.getBoundingClientRect();
              const before = e.clientX < rect.left + rect.width / 2;
              onReorder(src, tab.key, before);
            }}
          >
            {isDropBefore && (
              <span
                aria-hidden="true"
                className="absolute top-0 bottom-0 left-0 w-0.5 bg-[var(--color-accent)]"
              />
            )}
            {isDropAfter && (
              <span
                aria-hidden="true"
                className="absolute top-0 right-0 bottom-0 w-0.5 bg-[var(--color-accent)]"
              />
            )}
            {tab.pinned && (
              <span
                aria-hidden="true"
                title={t("tabs.pinned", "Pinned")}
                className="text-[var(--color-muted)]"
              >
                📌
              </span>
            )}
            <span className="max-w-[18rem] truncate" aria-label={rel}>
              {basename(tab.path)}
            </span>
            {tab.dirty && (
              <span aria-hidden="true" className="ml-0.5 text-[var(--color-accent)]">
                ●
              </span>
            )}
            {tab.orphaned && (
              <span
                aria-hidden="true"
                title={t("tabs.orphaned", "File no longer exists on disk")}
                className="ml-0.5 text-yellow-500"
              >
                ⚠
              </span>
            )}
            <button
              type="button"
              aria-label={
                tab.pinned ? t("tabs.unpin", "Unpin tab") : t("tabs.pin", "Pin tab")
              }
              className="ml-1 rounded px-1 text-[var(--color-muted)] opacity-0 transition-opacity hover:bg-[var(--color-border)]/40 hover:text-[var(--color-fg)] group-hover:opacity-100"
              onClick={(e) => {
                e.stopPropagation();
                onTogglePin(tab);
              }}
            >
              {tab.pinned ? "📍" : "📌"}
            </button>
            <button
              type="button"
              aria-label={t("tabs.close", "Close tab")}
              className="ml-1 rounded px-1 text-[var(--color-muted)] opacity-0 transition-opacity hover:bg-[var(--color-border)]/40 hover:text-[var(--color-fg)] group-hover:opacity-100"
              onClick={(e) => {
                e.stopPropagation();
                onClose(tab);
              }}
            >
              ×
            </button>
          </div>
        );
      })}
    </div>
  );
});
