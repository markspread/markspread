import { invoke } from "@tauri-apps/api/core";
import { useTranslation } from "react-i18next";
import { parentDir } from "../lib/open-md-file";
import { useRecentWorkspaces } from "../store/recent-workspaces";
import { useSingleFile } from "../store/single-file";
import { useWorkspace } from "../store/workspace";

export function SingleFile() {
  const { t } = useTranslation();
  const path = useSingleFile((s) => s.path);
  const content = useSingleFile((s) => s.content);
  const dirty = useSingleFile((s) => s.dirty);
  const setContent = useSingleFile((s) => s.setContent);
  const close = useSingleFile((s) => s.close);

  if (!path) return null;
  const parent = parentDir(path);

  async function convertToWorkspace() {
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
        </span>
        <div className="flex items-center gap-2">
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
        className="flex-1 overflow-auto p-6"
        aria-label={t("single_file.aria.editor", "Editor")}
      >
        <textarea
          className="h-full w-full resize-none bg-transparent font-mono text-sm outline-none"
          value={content}
          onChange={(e) => setContent(e.target.value)}
          aria-label={t("single_file.editor.aria", "File contents")}
        />
        {dirty && (
          <span className="pointer-events-none absolute right-6 bottom-2 text-[var(--color-muted)] text-xs">
            {t("single_file.status.unsaved", "Unsaved")}
          </span>
        )}
      </section>
    </main>
  );
}
