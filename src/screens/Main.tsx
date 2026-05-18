import { useEffect, useRef } from "react";
import { useTranslation } from "react-i18next";
import { EditorPane } from "../components/EditorPane";
import { FileTree } from "../components/FileTree";
import { PaneEditor } from "../components/PaneEditor";
import { PaneTree } from "../components/PaneTree";
import { Icon } from "../components/Icon";
import { SettingsSheet } from "../components/SettingsSheet";
import { ShortcutHint } from "../components/ShortcutHint";
import { SidebarPeek } from "../components/SidebarPeek";
import { SidebarSplitter } from "../components/SidebarSplitter";
import { TabBar } from "../components/TabBar";
import { useEditorLayout } from "../store/editor-layout";
import { WelcomeBanner } from "../components/WelcomeBanner";
import { useSidebarPeekHover } from "../hooks/useSidebarPeekHover";
import { useWorkspaceLayoutSync } from "../hooks/useWorkspaceLayoutSync";
import { SIDEBAR_DEFAULT_PX, SIDEBAR_RAIL_PX, useLayout } from "../store/layout";
import { useSettingsSheet } from "../store/settings-sheet";
import { useWorkspace } from "../store/workspace";

export function Main() {
  const { t } = useTranslation();
  const current = useWorkspace((s) => s.current);
  const close = useWorkspace((s) => s.close);
  const sidebarWidth = useLayout((s) =>
    current ? s.getSidebarWidth(current) : SIDEBAR_DEFAULT_PX,
  );
  const sidebarHidden = useLayout((s) =>
    current ? s.isSidebarHidden(current) : false,
  );
  const collapsedMode = useLayout((s) =>
    current ? s.getSidebarCollapsedMode(current) : "rail",
  );
  const toggleSidebar = useLayout((s) => s.toggleSidebar);
  const showSettings = useSettingsSheet((s) => s.show);
  const splitContainer = useRef<HTMLDivElement | null>(null);
  const prevHiddenRef = useRef(sidebarHidden);
  useWorkspaceLayoutSync(current ?? null);
  useSidebarPeekHover();

  // S-SBC-006: focus follows the sidebar toggle so keyboard-only users
  // are never stranded inside an `inert` aside. When the bar opens, the
  // file tree takes focus (VSCode parity). When it closes, focus moves
  // to the editor surface unless the user is already typing somewhere
  // outside the sidebar — then we leave their caret alone. Skips the
  // initial render so the very first paint doesn't steal focus from
  // restored state.
  useEffect(() => {
    if (!current) {
      prevHiddenRef.current = sidebarHidden;
      return;
    }
    const prev = prevHiddenRef.current;
    prevHiddenRef.current = sidebarHidden;
    if (prev === sidebarHidden) return;
    const activeInSidebar = !!document
      .querySelector('aside[data-sidebar-aside]')
      ?.contains(document.activeElement);
    if (sidebarHidden) {
      if (activeInSidebar) {
        const editor =
          document.querySelector<HTMLElement>("[data-editor-host] .cm-content") ??
          document.querySelector<HTMLElement>("[data-editor-host]");
        editor?.focus();
      }
    } else {
      const tree = document.querySelector<HTMLElement>('[data-filetree-root="true"]');
      tree?.focus();
    }
  }, [sidebarHidden, current]);

  // Cmd+, / Ctrl+, opens Settings, matching the platform convention. We
  // gate on `current` so the shortcut is workspace-only — there's nothing
  // useful to configure on the Welcome screen, and that screen has its
  // own keymap to worry about.
  useEffect(() => {
    if (!current) return;
    const onKey = (e: KeyboardEvent) => {
      const mod = e.metaKey || e.ctrlKey;
      if (mod && e.key === "," && !e.shiftKey && !e.altKey) {
        e.preventDefault();
        showSettings();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [current, showSettings]);

  return (
    <main
      className="flex h-full w-full flex-col"
      role="main"
      aria-label={t("main.aria.workspace", "Workspace")}
    >
      <WelcomeBanner />
      <ShortcutHint />
      <header className="flex items-center justify-between border-[var(--color-border)] border-b px-4 py-2">
        <span className="truncate font-medium text-sm" title={current ?? ""}>
          {current}
        </span>
        <div className="flex items-center gap-3">
          {current && (
            <button
              type="button"
              className="text-[var(--color-muted)] text-xs hover:text-[var(--color-fg)]"
              onClick={() => toggleSidebar(current)}
              aria-label={
                sidebarHidden
                  ? t("main.action.show_sidebar", "Show sidebar")
                  : t("main.action.hide_sidebar", "Hide sidebar")
              }
              aria-expanded={!sidebarHidden}
              aria-controls="filetree-aside"
              title={t("main.action.toggle_sidebar.tooltip", "Toggle sidebar (⌘B)")}
            >
              {sidebarHidden ? "▸" : "◂"}
            </button>
          )}
          <button
            type="button"
            className="text-[var(--color-muted)] text-xs hover:text-[var(--color-fg)]"
            onClick={showSettings}
            aria-label={t("main.action.settings", "Settings")}
            title={t("main.action.settings.tooltip", "Settings (⌘,)")}
          >
            <Icon name="settings" />
          </button>
          <button
            type="button"
            className="text-[var(--color-muted)] text-xs hover:underline"
            onClick={close}
          >
            {t("main.action.close_workspace", "Close workspace")}
          </button>
        </div>
      </header>
      <div ref={splitContainer} className="flex flex-1 overflow-hidden">
        {/* S-SBC-002: aside stays mounted across toggles so FileTree state
            (scroll, expanded folders) survives. Width is animated; the
            splitter is only rendered while visible since dragging a
            zero-width handle has no meaning. */}
        <aside
          id="filetree-aside"
          data-sidebar-aside
          className="shrink-0 overflow-hidden bg-[var(--color-surface-subtle)] text-sm transition-[width] duration-200 ease-out motion-reduce:transition-none"
          style={{ width: sidebarHidden ? 0 : sidebarWidth }}
          aria-label={t("main.aria.filetree", "File tree")}
          aria-hidden={sidebarHidden}
          inert={sidebarHidden}
        >
          {current && <FileTree workspace={current} />}
        </aside>
        {/* S-SBC-003: slim rail when collapsed-in-rail-mode. Clicking it
            reopens the sidebar (also re-arms the resize splitter). F2 will
            hang its peek-overlay trigger on this element via the
            data-sidebar-rail attribute. */}
        {sidebarHidden && current && collapsedMode === "rail" && (
          <button
            type="button"
            data-sidebar-rail
            onClick={() => toggleSidebar(current)}
            aria-label={t("main.aria.sidebar_rail", "Show sidebar")}
            aria-expanded={false}
            aria-haspopup="dialog"
            aria-controls="filetree-aside"
            title={t("main.action.sidebar_rail.tooltip", "Show sidebar (⌘B)")}
            style={{ width: SIDEBAR_RAIL_PX }}
            className="shrink-0 cursor-pointer border-0 bg-[var(--color-border)] p-0 hover:bg-[var(--color-accent)] focus-visible:bg-[var(--color-accent)] focus-visible:outline-none"
          />
        )}
        {!sidebarHidden && current && (
          <SidebarSplitter
            workspace={current}
            containerRef={splitContainer}
          />
        )}
        {current && (
          <EditorHost workspace={current} ariaLabel={t("main.aria.editor", "Editor")} />
        )}
      </div>
      <SettingsSheet />
      <SidebarPeek />
    </main>
  );
}

// S-ESP-003: walk the workspace layout tree. When no layout exists yet
// (fresh workspace, no legacy seed) we fall back to the legacy
// single-pane shell so opening files still works.
function EditorHost({ workspace, ariaLabel }: { workspace: string; ariaLabel: string }) {
  const layout = useEditorLayout((s) => s.layouts[workspace]);
  return (
    <section
      data-editor-host
      className="flex min-h-0 min-w-0 flex-1 flex-col"
      aria-label={ariaLabel}
    >
      {layout ? (
        <PaneTree
          workspace={workspace}
          node={layout.root}
          renderPane={(pane) => (
            <>
              <TabBar workspace={workspace} pane={pane} />
              <PaneEditor workspace={workspace} pane={pane} />
            </>
          )}
        />
      ) : (
        <>
          <TabBar workspace={workspace} />
          <EditorPane workspace={workspace} />
        </>
      )}
    </section>
  );
}
