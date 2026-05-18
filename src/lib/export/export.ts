// S-EXP-001..009: document export — PDF / HTML / DOCX / ePub / Print.
//
// Markspread exports the rendered preview output rather than re-parsing
// markdown into a separate output pipeline, so what users see is what
// they get. The renderer hands the sanitised HTML + the active theme
// tokens to the Rust side, which uses each format's specialist:
//
//   - PDF   → headless WebKit print-to-PDF via Tauri's `Window::print()`
//   - HTML  → inline-asset bundling (CSS, fonts, images base64-embedded)
//   - DOCX  → pandoc fallback with our preset reference docx
//   - ePub  → pandoc fallback
//   - Print → OS print dialog directly from the preview window
//
// Templates (S-EXP-009) are CSS files the user picks from a small
// dropdown; we ship a few defaults (Manuscript, Slide, Thesis) and the
// user's workspace can drop additional `.markspread/export-templates/*.css`
// files that show up automatically.

import { invoke } from "@tauri-apps/api/core";

export type ExportFormat = "pdf" | "html" | "docx" | "epub";

export interface PageSetup {
  /** A4, Letter, Legal — also accepts custom widths via Tauri. */
  size: "A4" | "Letter" | "Legal" | "A5" | "Custom";
  /** Used only when size === "Custom". Inches. */
  customWidthIn?: number;
  customHeightIn?: number;
  marginsIn: { top: number; right: number; bottom: number; left: number };
  orientation: "portrait" | "landscape";
  /** Optional header/footer string. Supports `${page}`, `${pageCount}`, `${title}`. */
  header?: string;
  footer?: string;
}

export const DEFAULT_PAGE_SETUP: PageSetup = {
  size: "A4",
  marginsIn: { top: 0.8, right: 0.8, bottom: 0.8, left: 0.8 },
  orientation: "portrait",
};

export interface ExportTemplate {
  id: string;
  label: string;
  /** CSS path relative to the workspace, or one of the bundled IDs. */
  cssPath: string;
}

export const BUILTIN_TEMPLATES: ExportTemplate[] = [
  { id: "default",     label: "Default",     cssPath: ":builtin:default.css" },
  { id: "manuscript",  label: "Manuscript",  cssPath: ":builtin:manuscript.css" },
  { id: "slide",       label: "Slide",       cssPath: ":builtin:slide.css" },
  { id: "thesis",      label: "Thesis",      cssPath: ":builtin:thesis.css" },
];

export interface ExportRequest {
  format: ExportFormat;
  /** Document path the export came from — null for unsaved buffers. */
  documentPath: string | null;
  /** Pre-sanitised HTML from the preview pane. */
  bodyHtml: string;
  /** Document title for the file name + header substitution. */
  title: string;
  template: ExportTemplate;
  pageSetup?: PageSetup;
  /** S-EXP-004: when true, external images are downloaded and inlined. */
  inlineExternalAssets?: boolean;
  /** Output path, or null to ask the user via the system save dialog. */
  outputPath?: string | null;
}

export interface ExportResult {
  ok: boolean;
  outputPath?: string;
  bytesWritten?: number;
  error?: { code: string; message: string };
}

export async function exportDocument(req: ExportRequest): Promise<ExportResult> {
  return invoke<ExportResult>("export_document", { req });
}

// S-EXP-007: route the print request to the OS dialog. The Rust side
// uses the active webview's `print()`; on success the dialog is shown
// modally over the editor.
export async function printPreview(): Promise<void> {
  await invoke("export_print");
}

// S-EXP-008: batch export. The renderer collects N (path, title) tuples
// and the Rust side iterates through, surfacing per-file progress so the
// user can see "12 / 47 done". The output path is a directory; each
// document writes `<title>.<ext>` inside it.
export interface BatchExportRequest {
  format: ExportFormat;
  documents: { path: string; title: string }[];
  outputDir: string;
  template: ExportTemplate;
  pageSetup?: PageSetup;
}

export interface BatchExportProgress {
  completed: number;
  total: number;
  currentTitle: string;
  /** Surfaced through the event stream; failures don't stop the batch. */
  failures: { path: string; reason: string }[];
}

export async function exportBatch(req: BatchExportRequest): Promise<{ failures: BatchExportProgress["failures"] }> {
  return invoke("export_batch", { req });
}
