// S-ESP-005: pane-aware editor host.
//
// EditorPane.tsx (legacy) reads from the global `useTabs.activePath` and
// keeps doc state in component-local React state. That model breaks down
// once we have N panes: each instance would fetch and track its own copy
// of every file, defeating the "buffer share" promise in S-ESP-007.
//
// PaneEditor instead:
//   - reads its active tab from the pane object (no global activePath dep)
//   - reads/writes baseline + live content through `useDocCache` so two
//     panes pointing at the same file share the buffer
//   - mounts a fresh `<Editor>` per (paneId, activeTabPath); cursor and
//     scroll are per-pane via Editor's own ViewState (S-ESP-006 wires the
//     persistence layer).
//
// The pane's TabBar still uses the legacy `useTabs` strip for now —
// S-ESP-009 swaps the whole shell over to the layout-driven model.

import { invoke } from "@tauri-apps/api/core";
import { memo, useCallback, useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { fromPosixError } from "../lib/access-policy/mapping";
import type { PaneNode } from "../lib/editor/layout-model";
import { detectExternalChange } from "../lib/external-change";
import { classifyFile, isMarkdownPath } from "../lib/file-kind";
import { saveTab } from "../lib/save-tab";
import { type DocBaseline, scheduleSave, useDocCache } from "../store/doc-cache";
import { useEditorLayout } from "../store/editor-layout";
import { useTabs } from "../store/tabs";
import { useToasts } from "../store/toasts";
import { useWorkspace } from "../store/workspace";
import { Editor } from "./Editor";
import { FileAccessErrorCard } from "./FileAccessErrorCard";
import { NonTextViewer } from "./NonTextViewer";
import { SpreadPane } from "./SpreadPane";

type ViewMode = "edit" | "spread" | "preview";

interface PaneEditorProps {
  workspace: string;
  pane: PaneNode;
}

const SAVE_DEBOUNCE_MS = 600;

interface FsReadResult {
  content: string;
  encoding: string;
  mtime?: number | null;
  sha256?: string | null;
}

export const PaneEditor = memo(function PaneEditor({ workspace, pane }: PaneEditorProps) {
  const { t } = useTranslation();
  const activeTabId = pane.activeTabId;
  const activeTab = activeTabId ? (pane.tabs.find((tab) => tab.id === activeTabId) ?? null) : null;
  const activePath = activeTab?.path ?? null;
  // T-U07-001-FIX-B: view-mode toggle. Defaults to edit; markdown files
  // can be flipped to spread (CodeMirror left, SpreadPane right) via the
  // header toggle or the `view.toggle_spread` command (Mod+Shift+V).
  const [viewMode, setViewMode] = useState<ViewMode>("edit");

  // Tracking inflight fetches in a ref keeps the load effect's deps small;
  // see EditorPane.tsx for the original rationale (S-EP-005 livelock).
  const inFlightRef = useRef<Set<string>>(new Set());
  const setDirty = useTabs((s) => s.setDirty);
  const readOnly = useWorkspace((s) => s.readOnly);
  const baseline = useDocCache((s) =>
    activePath ? s.baselines[`${workspace}::${activePath}`] : undefined,
  ) as DocBaseline | undefined;
  const error = useDocCache((s) =>
    activePath ? s.errors[`${workspace}::${activePath}`] : undefined,
  );
  const reloadEpoch = useDocCache((s) =>
    activePath ? (s.reloadEpoch[`${workspace}::${activePath}`] ?? 0) : 0,
  );
  // S-ESP-007: subscribe to the shared live content so when pane A types,
  // pane B's Editor sees a new `remoteDoc` and reconciles.
  const liveContent = useDocCache((s) =>
    activePath ? s.live[`${workspace}::${activePath}`] : undefined,
  );

  const activeKind = activePath ? classifyFile(activePath) : "text";

  useEffect(() => {
    if (!activePath) return;
    if (activeKind !== "text") return;
    const key = `${workspace}::${activePath}`;
    const s = useDocCache.getState();
    if (s.baselines[key] || s.errors[key] || inFlightRef.current.has(key)) return;
    let cancelled = false;
    inFlightRef.current.add(key);
    void (async () => {
      try {
        const result = await invoke<FsReadResult>("fs_read_file", {
          workspace,
          path: activePath,
        });
        if (cancelled) return;
        useDocCache.getState().setBaseline(workspace, activePath, {
          content: result.content,
          encoding: result.encoding,
          mtime: result.mtime ?? null,
          sha256: result.sha256 ?? null,
        });
      } catch (err) {
        if (cancelled) return;
        useDocCache.getState().setError(workspace, activePath, fromPosixError(err));
      } finally {
        inFlightRef.current.delete(key);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [activePath, activeKind, workspace, reloadEpoch]);

  const flushSave = useCallback(
    async (path: string) => {
      if (readOnly) return;
      const cache = useDocCache.getState();
      const content = cache.getLive(workspace, path);
      if (content === undefined) return;
      // S-ESP-008: stop the autosave if the file changed externally between
      // baseline capture and now. A toast informs the user; they choose
      // whether to reload or force-save manually.
      const base = cache.getBaseline(workspace, path);
      const change = await detectExternalChange(workspace, path, base?.mtime ?? null);
      if (change.kind === "modified" || change.kind === "deleted") {
        useToasts.getState().push({
          kind: "warning",
          message:
            change.kind === "deleted"
              ? t("save.external_deleted", "File deleted on disk; save paused")
              : t("save.external_changed", "File changed on disk; save paused"),
          details: path,
          ttlMs: 6000,
        });
        return;
      }
      await saveTab({ workspace, path, content });
    },
    [workspace, readOnly, t],
  );

  const handleChange = useCallback(
    (path: string) => (next: string) => {
      useDocCache.getState().setLive(workspace, path, next);
      const base = useDocCache.getState().getBaseline(workspace, path);
      const dirty = base !== undefined && next !== base.content;
      setDirty(path, dirty);
      // S-ESP-007: share a single per-path debounce so two panes on the
      // same file save once. The scheduler keys on (workspace, path).
      scheduleSave(workspace, path, SAVE_DEBOUNCE_MS, () => {
        if (dirty) void flushSave(path);
      });
    },
    [flushSave, setDirty, workspace],
  );

  if (!activePath) {
    return (
      <section
        className="flex flex-1 items-center justify-center p-6 text-[var(--color-muted)] text-sm"
        aria-label={t("editor.aria.empty", "Editor (no file open)")}
      >
        {t("editor.empty.hint", "Open a file from the sidebar to start reviewing.")}
      </section>
    );
  }

  if (activeKind !== "text") {
    return <NonTextViewer path={activePath} kind={activeKind} />;
  }

  if (error) {
    const retry = () => {
      useDocCache.getState().clearError(workspace, activePath);
      useDocCache.getState().bumpReload(workspace, activePath);
    };
    const copyDiagnostics = () => {
      const payload = JSON.stringify(
        {
          ruleId: error.ruleId,
          category: error.category,
          path: activePath,
          vars: error.vars ?? {},
        },
        null,
        2,
      );
      void navigator.clipboard?.writeText(payload);
    };
    return (
      <section
        className="flex flex-1 items-center justify-center p-6"
        aria-label={t("editor.aria.error", "Editor error")}
      >
        <FileAccessErrorCard
          decision={error}
          className="max-w-lg"
          handlers={{ retry, copy_diagnostics: copyDiagnostics }}
        />
      </section>
    );
  }

  if (!baseline) {
    return (
      <section
        className="flex flex-1 items-center justify-center p-6 text-[var(--color-muted)] text-sm"
        aria-label={t("editor.aria.loading", "Loading file")}
      >
        {t("editor.loading", "Loading…")}
      </section>
    );
  }

  const isMarkdown = isMarkdownPath(activePath);
  const previewSource = liveContent ?? baseline.content;
  const effectiveMode = isMarkdown ? viewMode : "edit";

  const editorNode = (
    <Editor
      tabId={`${pane.id}::${activePath}`}
      initialDoc={baseline.content}
      language={isMarkdown ? "markdown" : "plain"}
      onChange={handleChange(activePath)}
      remoteDoc={previewSource}
      {...(activeTab?.position ? { initialPosition: activeTab.position } : {})}
      onPositionChange={(pos) => {
        if (!activeTab) return;
        useEditorLayout.getState().setTabPosition(workspace, pane.id, activeTab.id, pos);
      }}
    />
  );

  return (
    <section
      data-pane-editor={pane.id}
      data-view-mode={effectiveMode}
      className="flex flex-1 min-h-0 min-w-0 flex-col"
      aria-label={t("editor.aria.host", "Editor")}
    >
      {isMarkdown && <ViewModeToggle mode={viewMode} onChange={setViewMode} />}
      {effectiveMode === "preview" ? (
        <SpreadPane
          workspace={workspace}
          pane={pane}
          documentPath={activePath}
          content={previewSource}
        />
      ) : effectiveMode === "spread" ? (
        <div className="flex min-h-0 min-w-0 flex-1 flex-row">
          <div className="flex min-h-0 min-w-0 flex-1 flex-col">{editorNode}</div>
          <div className="w-px shrink-0 bg-[var(--color-border)]" aria-hidden="true" />
          <div className="flex min-h-0 min-w-0 flex-1 flex-col">
            <SpreadPane
              workspace={workspace}
              pane={pane}
              documentPath={activePath}
              content={previewSource}
            />
          </div>
        </div>
      ) : (
        editorNode
      )}
    </section>
  );
});

function ViewModeToggle({
  mode,
  onChange,
}: {
  mode: ViewMode;
  onChange: (next: ViewMode) => void;
}) {
  const { t } = useTranslation();
  const options: { value: ViewMode; label: string }[] = [
    { value: "edit", label: t("editor.view.edit", "Edit") },
    { value: "spread", label: t("editor.view.spread", "Spread") },
    { value: "preview", label: t("editor.view.preview", "Preview") },
  ];
  return (
    <div
      role="radiogroup"
      aria-label={t("editor.view.aria", "View mode")}
      className="flex shrink-0 items-center gap-1 border-[var(--color-border)] border-b bg-[var(--color-surface-subtle)] px-2 py-1 text-xs"
    >
      {options.map((opt) => (
        <button
          key={opt.value}
          type="button"
          // biome-ignore lint/a11y/useSemanticElements: <input type="radio"> cannot host button label/styling; custom radiogroup
          role="radio"
          aria-checked={mode === opt.value}
          onClick={() => onChange(opt.value)}
          className={`rounded px-2 py-0.5 ${
            mode === opt.value
              ? "bg-[var(--color-accent)] text-white"
              : "text-[var(--color-muted)] hover:bg-[var(--color-border)]/30"
          }`}
        >
          {opt.label}
        </button>
      ))}
    </div>
  );
}
