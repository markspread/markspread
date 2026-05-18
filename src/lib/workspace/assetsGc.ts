// S-MD-011: garbage-collect unreferenced assets.
//
// Workflow:
//   1. The host injects a `WorkspaceAssetsGcAdapter` (FS unit owns the
//      Tauri-side traversal + trash invocation). This module stays
//      pure / testable.
//   2. `findUnusedAssets()` walks every `.md` / `.markdown` doc,
//      extracts referenced paths via a single regex (matches both
//      `![alt](path)` and `[text](path)` plus reference-style
//      definitions `[id]: path`), normalises each path to a workspace-
//      relative form, and diffs against the directory listing.
//   3. `trashAssets(paths)` defers to the adapter — usually
//      Tauri's `@tauri-apps/api/path` + `move_to_trash` Rust IPC. The
//      command never permanently deletes (acceptance bullet 2).
//
// We always operate on relative paths internally; the adapter is
// responsible for resolving against the workspace root.

export interface WorkspaceAssetsGcAdapter {
  /** List relative paths of every markdown file in the workspace. */
  listMarkdownFiles(): Promise<string[]>;
  /** Read a markdown file as UTF-8 string given its relative path. */
  readMarkdown(relPath: string): Promise<string>;
  /** List every file under `assets/` (relative paths). */
  listAssets(): Promise<string[]>;
  /** Move a list of relative-path files to the OS trash. */
  trashAssets(relPaths: string[]): Promise<void>;
}

const LINK_RE = /(!?)\[[^\]]*\]\(([^)\s]+)(?:\s+"[^"]*")?\)/g;
const REFDEF_RE = /^\s*\[[^\]]+\]:\s*(\S+)/gm;

function normalise(path: string, ownerDir: string): string {
  // Strip url-encoded fragments and query strings; we don't track
  // them in the asset filename.
  const clean = path.replace(/[?#].*$/, "");
  if (/^[a-z][a-z0-9+.-]*:/i.test(clean)) return ""; // external scheme
  if (clean.startsWith("/")) return clean.replace(/^\/+/, "");
  // Relative path: resolve against the doc's directory.
  const parts = ownerDir.split("/").filter(Boolean);
  for (const seg of clean.split("/")) {
    if (seg === "." || seg === "") continue;
    if (seg === "..") parts.pop();
    else parts.push(seg);
  }
  return parts.join("/");
}

export async function findUnusedAssets(adapter: WorkspaceAssetsGcAdapter): Promise<string[]> {
  const [docs, assets] = await Promise.all([adapter.listMarkdownFiles(), adapter.listAssets()]);
  const referenced = new Set<string>();
  for (const doc of docs) {
    const text = await adapter.readMarkdown(doc);
    const dir = doc.includes("/") ? doc.slice(0, doc.lastIndexOf("/")) : "";
    LINK_RE.lastIndex = 0;
    let linkM = LINK_RE.exec(text);
    while (linkM !== null) {
      const norm = normalise(linkM[2] ?? "", dir);
      if (norm) referenced.add(norm);
      linkM = LINK_RE.exec(text);
    }
    REFDEF_RE.lastIndex = 0;
    let refM = REFDEF_RE.exec(text);
    while (refM !== null) {
      const norm = normalise(refM[1] ?? "", dir);
      if (norm) referenced.add(norm);
      refM = REFDEF_RE.exec(text);
    }
  }
  return assets.filter((a) => !referenced.has(a));
}

export async function cleanUnusedAssets(
  adapter: WorkspaceAssetsGcAdapter,
  confirm: (candidates: string[]) => Promise<boolean>,
): Promise<{ trashed: string[] }> {
  const unused = await findUnusedAssets(adapter);
  if (unused.length === 0) return { trashed: [] };
  const ok = await confirm(unused);
  if (!ok) return { trashed: [] };
  await adapter.trashAssets(unused);
  return { trashed: unused };
}
