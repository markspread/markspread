// S-IMP-001..003: import non-markdown source documents.
//
// We support three import sources:
//
//   - DOCX → markdown via pandoc (fidelity is reasonable for prose;
//            tables / footnotes carry over, embedded media becomes
//            attachment files in `<basename>.assets/`)
//   - HTML → markdown via a Rust-side `html2md` pass that runs the
//            sanitiser first (no scripts/styles in the output)
//   - PDF  → plain-text extraction. We're explicit that PDF import
//            loses formatting; the result is a `# Title` followed by
//            paragraph text, with a heuristic header detector for
//            ALL-CAPS short lines.
//
// Output is always a tuple of (markdown, assets[]) so the caller can
// choose where to drop them — Settings → Workspace → Import opens the
// files inline; the file-tree drag-import drops them as siblings.

import { invoke } from "@tauri-apps/api/core";

export type ImportSource = "docx" | "html" | "pdf";

export interface ImportRequest {
  source: ImportSource;
  /** Absolute path to the source file on disk. */
  inputPath: string;
  /** Where assets (images embedded in the source) should land. */
  assetsDir: string;
  /** When true, also produces a `.imported.json` audit alongside the markdown. */
  emitAudit?: boolean;
}

export interface ImportResult {
  markdown: string;
  assets: { sourceName: string; outputPath: string; bytes: number }[];
  /** Lossy-conversion warnings — surfaced as a chip in the editor. */
  warnings: string[];
}

export async function importDocument(req: ImportRequest): Promise<ImportResult> {
  return invoke<ImportResult>("import_document", { req });
}

// S-IMP-003: PDF text-extraction caveats. We always include this set of
// warnings because the user should know that PDF → md is not a faithful
// round-trip — they need to review headers, lists, tables.
export const PDF_IMPORT_CAVEATS = [
  "headings are inferred from font weight / size — review them",
  "tables become text blocks (PDF lacks table structure information)",
  "footnotes and endnotes are appended to the end of the document",
  "images are extracted only if the PDF embeds them as objects",
];

// File-extension to source mapping for the open dialog filter and
// drag-and-drop type detection.
export const IMPORT_FILTERS: { source: ImportSource; extensions: string[] }[] = [
  { source: "docx", extensions: ["docx"] },
  { source: "html", extensions: ["html", "htm"] },
  { source: "pdf",  extensions: ["pdf"] },
];

export function detectSourceByExtension(path: string): ImportSource | null {
  const ext = path.split(".").pop()?.toLowerCase();
  if (!ext) return null;
  for (const f of IMPORT_FILTERS) {
    if (f.extensions.includes(ext)) return f.source;
  }
  return null;
}
