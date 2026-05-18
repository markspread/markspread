// S-EXP-001..009 host surface: format picker + template + Save. The
// dialog reads the active preview HTML (passed in via props since the
// preview pipeline owns rendering) and dispatches to `exportDocument`.

import { useState } from "react";
import { useTranslation } from "react-i18next";
import {
  BUILTIN_TEMPLATES,
  type ExportFormat,
  type ExportTemplate,
  exportDocument,
} from "../lib/export/export";
import { useFocusTrap } from "../lib/focus-trap";

interface ExportDialogProps {
  open: boolean;
  onClose: () => void;
  documentPath: string | null;
  documentTitle: string;
  bodyHtml: string;
}

const FORMATS: { id: ExportFormat; label: string }[] = [
  { id: "pdf", label: "PDF" },
  { id: "html", label: "HTML" },
  { id: "docx", label: "DOCX" },
  { id: "epub", label: "ePub" },
];

export function ExportDialog({
  open,
  onClose,
  documentPath,
  documentTitle,
  bodyHtml,
}: ExportDialogProps) {
  const { t } = useTranslation();
  const [format, setFormat] = useState<ExportFormat>("pdf");
  // biome-ignore lint/style/noNonNullAssertion: BUILTIN_TEMPLATES is a non-empty constant array
  const [template, setTemplate] = useState<ExportTemplate>(BUILTIN_TEMPLATES[0]!);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState<string | null>(null);
  const trapRef = useFocusTrap<HTMLDivElement>({ active: open, onEscape: onClose });

  const run = async () => {
    setBusy(true);
    setStatus(null);
    try {
      const result = await exportDocument({
        format,
        documentPath,
        bodyHtml,
        title: documentTitle,
        template,
      });
      if (result.ok) {
        setStatus(
          result.outputPath
            ? t("export.done", "Exported to {{path}}", { path: result.outputPath })
            : t("export.done_anon", "Export complete."),
        );
      } else {
        setStatus(result.error?.message ?? t("export.failed", "Export failed."));
      }
    } catch (e) {
      setStatus(String((e as { message?: string })?.message ?? e));
    } finally {
      setBusy(false);
    }
  };

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40"
      // biome-ignore lint/a11y/useSemanticElements: dialog overlay keeps div for layout/portal control
      role="dialog"
      aria-modal="true"
      aria-label={t("export.aria", "Export document")}
    >
      <div
        ref={trapRef}
        className="w-full max-w-md rounded-lg border border-[var(--color-border)] bg-[var(--color-bg)] p-6 shadow-xl"
      >
        <h2 className="font-semibold text-base">{t("export.title", "Export")}</h2>
        <label className="mt-4 flex items-center gap-2 text-xs">
          <span className="w-20 text-[var(--color-muted)]">{t("export.format", "Format")}</span>
          <select
            className="flex-1 rounded border border-[var(--color-border)] bg-transparent px-2 py-1 text-xs"
            value={format}
            onChange={(e) => setFormat(e.target.value as ExportFormat)}
          >
            {FORMATS.map((f) => (
              <option key={f.id} value={f.id}>
                {f.label}
              </option>
            ))}
          </select>
        </label>
        <label className="mt-2 flex items-center gap-2 text-xs">
          <span className="w-20 text-[var(--color-muted)]">{t("export.template", "Template")}</span>
          <select
            className="flex-1 rounded border border-[var(--color-border)] bg-transparent px-2 py-1 text-xs"
            value={template.id}
            onChange={(e) => {
              const next = BUILTIN_TEMPLATES.find((tpl) => tpl.id === e.target.value);
              if (next) setTemplate(next);
            }}
          >
            {BUILTIN_TEMPLATES.map((tpl) => (
              <option key={tpl.id} value={tpl.id}>
                {tpl.label}
              </option>
            ))}
          </select>
        </label>
        {status && <p className="mt-3 text-[var(--color-muted)] text-xs">{status}</p>}
        <div className="mt-6 flex justify-end gap-2">
          <button
            type="button"
            className="rounded-md border border-[var(--color-border)] px-4 py-2 text-sm"
            onClick={onClose}
            disabled={busy}
          >
            {t("export.close", "Close")}
          </button>
          <button
            type="button"
            disabled={busy}
            onClick={() => void run()}
            className="rounded-md bg-[var(--color-accent)] px-4 py-2 font-medium text-sm text-white disabled:opacity-50"
          >
            {t("export.run", "Export")}
          </button>
        </div>
      </div>
    </div>
  );
}
