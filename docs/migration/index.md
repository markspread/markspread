# Migration guides

Markspread ships first-party migrators for the markdown apps users most often switch from. Each guide below covers what carries over cleanly, what changes shape, and what the migrator does not bring across.

The migrator never writes outside the workspace folder you pick. Original source files are left intact — re-running the migration is safe.

## Obsidian → Markspread

1. **File → Import → Obsidian vault**
2. Select the vault folder (the parent that contains `.obsidian/`).
3. Pick a destination workspace.

**What carries across cleanly**

- Every `.md` file (1:1 copy)
- `[[wiki-link]]` resolution
- Tag mentions (`#tag`)
- Daily-notes folder + template
- The backlink graph is rebuilt from scratch (we don't read `.obsidian/cache`)

**What changes shape**

- Dataview queries → fenced code blocks (preserved as-is, displayed inert)
- Callouts (`> [!note]`) → block-quotes with a leading `**Note**` label

**What is dropped**

- `.obsidian/` settings: Markspread has its own themes / hotkeys
- Plugin-specific syntax outside CommonMark + GFM

## Typora → Markspread

1. **File → Import → Typora workspace**
2. Select the folder Typora uses for the workspace.
3. Asset folders (`<note>.assets/`) are copied alongside each note.

Math mode (TeX) renders through the same KaTeX pipeline — no changes required.

## iA Writer → Markspread

1. **File → Import → iA Writer library**
2. Select the library folder.
3. Content blocks (`/path/to/file.md`) become wiki-links so the link graph is preserved.

## Notion Markdown export → Markspread

1. In Notion: **Settings → Export all workspace content → Markdown & CSV**.
2. In Markspread: **File → Import → Notion export (.zip)**.
3. The page tree's nested folders are preserved; embedded images go into per-page asset folders.

Database views import as the markdown-table representation only. Synced blocks resolve to their first-source content with a small "synced from <page>" footnote.

## Logseq → Markspread

1. **File → Import → Logseq graph**
2. Select the graph root (the folder containing `pages/` and `journals/`).
3. Block-level outline structure flattens into paragraphs under their parent headings.

Clojure-side queries (`{{query …}}`) are preserved as code blocks so a future round-trip can pick them up.

---

If your source app isn't listed, the closest path is: export to plain markdown, drop the resulting folder into a workspace, then run **Edit → Reformat → CommonMark Normalise** (Settings → Markdown → Strict mode) to clean up rough edges.
