// S-EP-010: classify a path by extension so the editor pane can route binary
// files to a viewer instead of dumping bytes into CodeMirror. The list errs
// toward text — when an extension is unknown we treat it as text and let the
// backend's encoding sniffing decide; this matches how a non-developer would
// expect "open file" to work for plain `.log`, `.cfg`, `.env`, etc.

export type FileKind = "text" | "image" | "pdf" | "binary";

const IMAGE_EXTS = new Set([
  "png",
  "jpg",
  "jpeg",
  "gif",
  "webp",
  "bmp",
  "ico",
  "svg",
  "avif",
]);

const BINARY_EXTS = new Set([
  // archives
  "zip", "tar", "gz", "tgz", "bz2", "xz", "7z", "rar",
  // executables / objects
  "exe", "dll", "so", "dylib", "o", "a", "lib", "obj",
  // fonts
  "ttf", "otf", "woff", "woff2", "eot",
  // audio / video
  "mp3", "wav", "flac", "ogg", "m4a", "aac",
  "mp4", "mov", "avi", "mkv", "webm", "m4v",
  // images that aren't shown inline (we still classify as binary)
  "psd", "ai", "tiff", "tif", "heic", "heif", "raw",
  // documents
  "doc", "docx", "xls", "xlsx", "ppt", "pptx", "pages", "numbers", "key",
  // databases / pickled / serialized
  "db", "sqlite", "sqlite3", "pkl", "pyc", "class", "jar",
]);

export function classifyFile(path: string): FileKind {
  const lastSlash = Math.max(path.lastIndexOf("/"), path.lastIndexOf("\\"));
  const name = lastSlash >= 0 ? path.slice(lastSlash + 1) : path;
  const dot = name.lastIndexOf(".");
  if (dot < 0) return "text";
  const ext = name.slice(dot + 1).toLowerCase();
  if (IMAGE_EXTS.has(ext)) return "image";
  if (ext === "pdf") return "pdf";
  if (BINARY_EXTS.has(ext)) return "binary";
  return "text";
}

const MARKDOWN_EXTS = new Set(["md", "markdown", "mdown", "mkd", "mdx", "mdc"]);

/**
 * Markdown-flavored extensions get the full Markspread treatment (autolinks,
 * tables, task toggles, frontmatter fold, …). Everything else opens as plain
 * text so a `.ts` or `.json` file isn't reflowed as if it were Markdown.
 */
export function isMarkdownPath(path: string): boolean {
  const lastSlash = Math.max(path.lastIndexOf("/"), path.lastIndexOf("\\"));
  const name = lastSlash >= 0 ? path.slice(lastSlash + 1) : path;
  const dot = name.lastIndexOf(".");
  if (dot < 0) return false;
  return MARKDOWN_EXTS.has(name.slice(dot + 1).toLowerCase());
}
