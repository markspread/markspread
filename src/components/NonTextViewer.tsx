// S-EP-011: viewer for files the editor refuses to open as text. Image files
// render inline via the asset:// protocol; everything else gets a "binary file"
// placard with reveal-in-finder + open-with-default-app actions. Keeping the
// guard at the React layer (not the IPC layer) means we never send the bytes
// of a 50MB PNG over the wire just to discard them.

import { convertFileSrc, invoke } from "@tauri-apps/api/core";
import { useTranslation } from "react-i18next";
import type { FileKind } from "../lib/file-kind";

interface NonTextViewerProps {
  path: string;
  kind: Exclude<FileKind, "text">;
}

function basename(path: string): string {
  const i = Math.max(path.lastIndexOf("/"), path.lastIndexOf("\\"));
  return i >= 0 ? path.slice(i + 1) : path;
}

export function NonTextViewer({ path, kind }: NonTextViewerProps) {
  const { t } = useTranslation();
  const name = basename(path);

  if (kind === "image") {
    const src = convertFileSrc(path);
    return (
      <section
        className="flex flex-1 min-h-0 min-w-0 items-center justify-center overflow-auto bg-[var(--color-surface-subtle)] p-6"
        aria-label={t("editor.viewer.image_aria", "Image preview")}
      >
        <img
          src={src}
          alt={name}
          className="max-h-full max-w-full object-contain"
          style={{ imageRendering: "auto" }}
        />
      </section>
    );
  }

  const reveal = () => {
    void invoke("os_reveal_path", { path }).catch(() => undefined);
  };
  const openWith = () => {
    void invoke("os_open_with", { path }).catch(() => undefined);
  };

  const headline =
    kind === "pdf"
      ? t("editor.viewer.pdf_headline", "PDF preview is not yet supported.")
      : t("editor.viewer.binary_headline", "This file is not a text document.");

  return (
    <section
      className="flex flex-1 min-h-0 min-w-0 flex-col items-center justify-center gap-3 p-6 text-center"
      aria-label={t("editor.viewer.binary_aria", "Non-text file")}
    >
      <p className="font-medium text-sm">{headline}</p>
      <p className="break-all text-[var(--color-muted)] text-xs">{name}</p>
      <div className="mt-2 flex gap-2">
        <button
          type="button"
          onClick={reveal}
          className="rounded border border-[var(--color-border)] bg-[var(--color-surface)] px-3 py-1.5 text-xs hover:bg-[var(--color-surface-subtle)]"
        >
          {t("editor.viewer.reveal", "Reveal in file manager")}
        </button>
        <button
          type="button"
          onClick={openWith}
          className="rounded border border-[var(--color-border)] bg-[var(--color-surface)] px-3 py-1.5 text-xs hover:bg-[var(--color-surface-subtle)]"
        >
          {t("editor.viewer.open_with", "Open with default app")}
        </button>
      </div>
    </section>
  );
}
