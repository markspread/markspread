// S-AI-014: optional sidecar mode for Translate.
//
// When the user enables "preserve original" we never touch the source file —
// instead the translation lands at `<basename>.<lang>.<ext>` next to the
// original. We compute the sidecar path here so the caller can confirm with
// the user (overwrite prompt) before we hit the filesystem.

export function sidecarPath(originalPath: string, langTag: string): string {
  const slash = Math.max(originalPath.lastIndexOf("/"), originalPath.lastIndexOf("\\"));
  const dir = slash >= 0 ? originalPath.slice(0, slash + 1) : "";
  const fileName = slash >= 0 ? originalPath.slice(slash + 1) : originalPath;
  // Strip an existing language tag if the user is re-translating an already
  // translated sidecar (`README.ko.md` → `README.ja.md`, not `README.ko.ja.md`).
  const stripped = fileName.replace(/\.([a-z]{2}(-[A-Za-z]{2,4})?)\.([^.]+)$/, ".$3");
  const dot = stripped.lastIndexOf(".");
  const base = dot >= 0 ? stripped.slice(0, dot) : stripped;
  const ext = dot >= 0 ? stripped.slice(dot) : ".md";
  return `${dir}${base}.${langTag}${ext}`;
}
