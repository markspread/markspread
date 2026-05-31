import { invoke } from "@tauri-apps/api/core";
import { useCallback, useEffect } from "react";
import { useTranslation } from "react-i18next";
import { Editor } from "../components/Editor";
import { isMarkdownPath } from "../lib/file-kind";
import { parentDir } from "../lib/open-md-file";
import { useRecentWorkspaces } from "../store/recent-workspaces";
import { useSingleFile } from "../store/single-file";
import { useToasts } from "../store/toasts";
import { useWorkspace } from "../store/workspace";

export function SingleFile() {
  const { t } = useTranslation();
  const path = useSingleFile((s) => s.path);
  const content = useSingleFile((s) => s.content);
  const dirty = useSingleFile((s) => s.dirty);
  const setContent = useSingleFile((s) => s.setContent);
  const markSaved = useSingleFile((s) => s.markSaved);
  const close = useSingleFile((s) => s.close);

  // FIX (no-save bug): Cmd+S 로 fs_write 호출 + dirty clear.
  const save = useCallback(async () => {
    if (!path) return;
    try {
      await invoke("fs_write", {
        workspace: parentDir(path),
        path,
        content,
      });
      markSaved();
      useToasts.getState().push({
        kind: "info",
        message: t("single_file.toast.saved", "저장됨"),
      });
    } catch (e) {
      useToasts.getState().push({
        kind: "error",
        message: t("single_file.toast.save_failed", "저장 실패"),
        details: String(e),
      });
    }
  }, [path, content, markSaved, t]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const mod = e.metaKey || e.ctrlKey;
      if (mod && e.key.toLowerCase() === "s") {
        e.preventDefault();
        void save();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [save]);

  if (!path) return null;
  const parent = parentDir(path);
  const isMd = isMarkdownPath(path);

  async function convertToWorkspace() {
    /* v8 ignore next -- the component returns null above when !path, so this closure narrow only exists to satisfy TS */
    if (!path) return;
    await invoke("workspace_scaffold", { workspace: parent });
    useWorkspace.getState().open(parent);
    useRecentWorkspaces.getState().add(parent);
    useSingleFile.getState().close();
  }

  return (
    <main
      className="flex h-full w-full flex-col"
      aria-label={t("single_file.aria.main", "Single file view")}
    >
      <output
        className="flex w-full items-center justify-between gap-3 border-[var(--color-border)] border-b bg-[var(--color-surface-subtle)] px-4 py-2 text-xs"
        aria-label={t("single_file.banner.aria", "Single file banner")}
      >
        <span className="text-[var(--color-muted)]">
          {t("single_file.banner.message", "Editing a single file outside a workspace.")}
          <span className="ml-2 truncate font-medium" title={path}>
            {path}
          </span>
          {dirty && (
            <span
              className="ml-2 text-amber-600 dark:text-amber-400"
              data-testid="single-file-dirty-badge"
            >
              ● {t("single_file.status.unsaved", "Unsaved")}
            </span>
          )}
        </span>
        <div className="flex items-center gap-2">
          <button
            type="button"
            data-testid="single-file-save"
            disabled={!dirty}
            className="rounded border border-[var(--color-border)] px-2 py-1 hover:bg-[var(--color-border)]/30 disabled:opacity-50"
            onClick={() => void save()}
            title={t("single_file.action.save_tooltip", "⌘S")}
          >
            {t("single_file.action.save", "저장")}
          </button>
          <button
            type="button"
            className="rounded border border-[var(--color-border)] px-2 py-1 hover:bg-[var(--color-border)]/30"
            onClick={() => void convertToWorkspace()}
            title={parent}
          >
            {t("single_file.action.convert_to_workspace", "Convert folder to workspace")}
          </button>
          <button
            type="button"
            className="text-[var(--color-muted)] hover:underline"
            onClick={close}
          >
            {t("single_file.action.close", "Close")}
          </button>
        </div>
      </output>
      <section
        className="flex flex-1 min-h-0 overflow-hidden"
        aria-label={t("single_file.aria.editor", "Editor")}
        data-testid="single-file-editor"
      >
        {/* FIX: 이전엔 raw textarea 였음. CodeMirror 6 Editor 로 교체 — md highlight, 키바인딩, ADR-0014 readOnly 지원 */}
        <Editor
          tabId={path}
          initialDoc={content}
          language={isMd ? "markdown" : "plain"}
          onChange={(doc) => setContent(doc)}
        />
      </section>
    </main>
  );
}
