// S-MIG-001..008: import workflows for popular markdown apps.
//
// Each source has its own quirks; we keep the per-source logic in a
// single registry so the migration UI can render a clean picker and
// the docs site has one place to point to. The actual file copying +
// transformation happens Rust-side via `migrate_run`.
//
// Compatibility notes ride along with each adapter so users see a
// "what we map / what we skip" preview before kicking off the migration.

export type MigrationSource = "obsidian" | "typora" | "ia-writer" | "notion" | "logseq";

export interface MigrationAdapter {
  source: MigrationSource;
  label: string;
  /** Path the user picks — vault folder for Obsidian, workspace for Typora, etc. */
  expects: "folder" | "zip";
  /** Per-source compatibility list, surfaced before the run. */
  notes: { mapped: string[]; skipped: string[]; partial: string[] };
}

export const MIGRATION_ADAPTERS: MigrationAdapter[] = [
  {
    source: "obsidian",
    label: "Obsidian Vault",
    expects: "folder",
    notes: {
      mapped: [
        "Markdown files (1:1 copy)",
        "Wiki-links `[[Note]]` (resolved to Markspread's link graph)",
        "Backlinks index (regenerated; not the cached `.obsidian/cache`)",
        "Tags (`#tag`) — indexed natively",
        "Daily notes folder + template",
      ],
      partial: [
        "Embedded queries (Dataview): pasted as fenced code blocks",
        "Custom callouts: rendered as block-quotes with class names",
      ],
      skipped: [
        "Plugin-specific syntax not in the CommonMark/GFM superset",
        "`.obsidian/` settings (themes, hotkeys — Markspread has its own)",
      ],
    },
  },
  {
    source: "typora",
    label: "Typora workspace",
    expects: "folder",
    notes: {
      mapped: [
        "Markdown files",
        "Image folder (`<note>.assets/`) — copied alongside",
        "Math mode (TeX) — rendered via the same KaTeX pipeline",
      ],
      partial: ["Inline footnote shorthand — converted to GFM footnotes"],
      skipped: ["Typora-only Pandoc footnote inline forms"],
    },
  },
  {
    source: "ia-writer",
    label: "iA Writer library",
    expects: "folder",
    notes: {
      mapped: [
        "Markdown files",
        "Content blocks (`/path/to/file.md`) — resolved to wiki-links",
        "Tags",
      ],
      partial: ["Smart Tables — converted to GFM tables when shape allows"],
      skipped: ["Word-count snapshots (non-portable)"],
    },
  },
  {
    source: "notion",
    label: "Notion Markdown export",
    expects: "zip",
    notes: {
      mapped: [
        "Page tree (subfolders mirror Notion's nesting)",
        "Embedded images (resolved into a per-page assets folder)",
        "Toggle blocks → details/summary",
      ],
      partial: [
        "Database views: only the markdown table representation is kept",
        "Synced blocks: rendered once with a note about origin",
      ],
      skipped: [
        "Inline mentions to people (unmapped — kept as text)",
        "Comments (Notion doesn't include them in export)",
      ],
    },
  },
  {
    source: "logseq",
    label: "Logseq graph",
    expects: "folder",
    notes: {
      mapped: [
        "Pages (`pages/`) and journals (`journals/`)",
        "Block references → footnote-style citations",
        "Tags and properties (front-matter)",
      ],
      partial: ["Block-level outline: collapsed into headed paragraphs"],
      skipped: ["Clojure-side queries (`{{query …}}`) — left as code blocks"],
    },
  },
];

import { invoke } from "@tauri-apps/api/core";

export interface MigrationRunRequest {
  source: MigrationSource;
  inputPath: string;
  /** Workspace destination. The migrator never writes outside this. */
  outputPath: string;
  /** When true, source files are copied; when false, the migrator emits a manifest only. */
  copyFiles: boolean;
}

export interface MigrationRunResult {
  filesProcessed: number;
  filesWritten: number;
  warnings: string[];
  errors: { path: string; reason: string }[];
}

export async function runMigration(req: MigrationRunRequest): Promise<MigrationRunResult> {
  return invoke<MigrationRunResult>("migrate_run", { req });
}
