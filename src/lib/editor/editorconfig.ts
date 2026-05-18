// S-ED-025: minimal .editorconfig resolver for per-file indent
// overrides. We support the subset of editorconfig that's relevant to
// the markdown editor:
//
//   • indent_style = tab | space
//   • indent_size  = <number>
//   • tab_width    = <number>
//   • root         = true (stops the upward walk)
//
// Pattern semantics: simple glob matching for `[*.md]`, `[*]`, and
// `[*.{md,markdown}]`. We don't pull in the editorconfig npm package
// because it bundles a regex-from-glob library; this minimal subset
// keeps the editor bundle ~30KB lighter and covers every real-world
// .editorconfig the team has shipped to date.

import type { EditorPrefs } from "./settings";

export type EditorconfigPatch = Partial<
  Pick<EditorPrefs, "indentWithTabs" | "indentSize" | "tabSize">
>;

type Section = { glob: string; props: Record<string, string> };

export function parseEditorconfig(text: string): {
  root: boolean;
  sections: Section[];
} {
  const lines = text.split(/\r?\n/);
  let root = false;
  const sections: Section[] = [];
  let current: Section | null = null;
  for (const raw of lines) {
    const line = raw.trim();
    if (!line || line.startsWith("#") || line.startsWith(";")) continue;
    if (line.startsWith("[") && line.endsWith("]")) {
      current = { glob: line.slice(1, -1), props: {} };
      sections.push(current);
      continue;
    }
    const eq = line.indexOf("=");
    if (eq === -1) continue;
    const key = line.slice(0, eq).trim().toLowerCase();
    const value = line.slice(eq + 1).trim();
    if (!current) {
      if (key === "root") root = value.toLowerCase() === "true";
      continue;
    }
    current.props[key] = value;
  }
  return { root, sections };
}

function globMatchesFilename(glob: string, filename: string): boolean {
  // Expand brace alternation: *.{md,markdown} → *.md / *.markdown
  if (glob.includes("{") && glob.includes("}")) {
    const start = glob.indexOf("{");
    const end = glob.indexOf("}", start);
    const before = glob.slice(0, start);
    const after = glob.slice(end + 1);
    const alts = glob.slice(start + 1, end).split(",");
    return alts.some((alt) => globMatchesFilename(before + alt + after, filename));
  }
  // Convert simple glob to regex: ** → .*, * → [^/]*, ? → .
  const pattern = `^${glob
    .replace(/[.+^${}()|\\[\]]/g, "\\$&")
    .replace(/\*\*/g, "<<DOUBLESTAR>>")
    .replace(/\*/g, "[^/]*")
    .replace(/<<DOUBLESTAR>>/g, ".*")
    .replace(/\?/g, ".")}$`;
  return new RegExp(pattern).test(filename);
}

export function patchFromEditorconfig(text: string, filename: string): EditorconfigPatch {
  const { sections } = parseEditorconfig(text);
  const patch: EditorconfigPatch = {};
  for (const sec of sections) {
    if (!globMatchesFilename(sec.glob, filename)) continue;
    if (sec.props.indent_style === "tab") patch.indentWithTabs = true;
    if (sec.props.indent_style === "space") patch.indentWithTabs = false;
    const size = Number(sec.props.indent_size);
    if (Number.isFinite(size) && size > 0) patch.indentSize = size;
    const tab = Number(sec.props.tab_width);
    if (Number.isFinite(tab) && tab > 0) patch.tabSize = tab;
  }
  return patch;
}

/** Merge a patch into a baseline prefs object (workspace settings). */
export function applyEditorconfigPatch(base: EditorPrefs, patch: EditorconfigPatch): EditorPrefs {
  return { ...base, ...patch };
}
