// S-PR-012..015: Outline tab data model.
//
// We extract headings from the raw markdown source (cheaper than
// parsing the full HTML tree) and emit a flat list with depth +
// 1-based source line. The tree shape comes for free from depth.
//
// The active heading (S-PR-014) is whichever heading sits at the
// same line as the editor's current cursor or the most recent
// heading above it — the consumer decides via `findActiveHeading`.

export interface Heading {
  text: string;
  depth: number; // 1-6
  line: number; // 1-based source line
  /** GitHub-style anchor slug (lowercase, hyphenated). */
  slug: string;
}

const ATX_RE = /^(#{1,6})\s+(.+?)\s*#*\s*$/;
const SETEXT_UNDER_RE = /^\s*(=+|-+)\s*$/;

export function extractHeadings(md: string): Heading[] {
  const lines = md.split(/\r?\n/);
  const out: Heading[] = [];
  let inFence = false;
  let fenceMarker = "";
  for (let i = 0; i < lines.length; i++) {
    const raw = lines[i];
    if (raw === undefined) continue;
    const trimmed = raw.trim();
    if (inFence) {
      if (trimmed.startsWith(fenceMarker)) inFence = false;
      continue;
    }
    if (trimmed.startsWith("```") || trimmed.startsWith("~~~")) {
      inFence = true;
      fenceMarker = trimmed.slice(0, 3);
      continue;
    }
    const atx = ATX_RE.exec(raw);
    if (atx) {
      const depth = (atx[1] ?? "").length;
      const text = atx[2] ?? "";
      out.push({
        text,
        depth,
        line: i + 1,
        slug: slugify(text),
      });
      continue;
    }
    // Setext: a non-empty line followed by `===` or `---` of >= 1 char
    const next = lines[i + 1];
    if (
      next !== undefined &&
      raw.trim().length > 0 &&
      SETEXT_UNDER_RE.test(next)
    ) {
      const depth = next.trim().startsWith("=") ? 1 : 2;
      out.push({
        text: raw.trim(),
        depth,
        line: i + 1,
        slug: slugify(raw.trim()),
      });
    }
  }
  return out;
}

export function findActiveHeading(
  headings: Heading[],
  cursorLine: number,
): Heading | null {
  let active: Heading | null = null;
  for (const h of headings) {
    if (h.line <= cursorLine) active = h;
    else break;
  }
  return active;
}

export function filterHeadings(headings: Heading[], query: string): Heading[] {
  if (!query.trim()) return headings;
  const q = query.toLowerCase();
  return headings.filter((h) => h.text.toLowerCase().includes(q));
}

export function slugify(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^\p{Letter}\p{Number}\s-]/gu, "")
    .replace(/\s+/g, "-")
    .replace(/-{2,}/g, "-")
    .replace(/^-+|-+$/g, "");
}
