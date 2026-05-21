// S-A11-011: heading-structure utilities for the markdown preview.
//
// Screen readers rely on heading levels for the rotor — skipping a level
// (e.g. h1 → h3) leaves users unable to predict outline depth. Our renderer
// pipes the parsed heading list through `validateHeadings` so we can either
// fix or warn at render time. The renderer itself is intentionally not
// rewriting source markdown — it surfaces structural issues to the editor
// so authors can correct them.

export interface ParsedHeading {
  level: 1 | 2 | 3 | 4 | 5 | 6;
  text: string;
  /** 1-based source line — used to drive the editor's inline diagnostic. */
  line: number;
}

export interface HeadingViolation {
  kind: "skipped-level" | "multiple-h1";
  message: string;
  heading: ParsedHeading;
}

export function validateHeadings(headings: ParsedHeading[]): HeadingViolation[] {
  const violations: HeadingViolation[] = [];
  let lastLevel = 0;
  let h1Count = 0;
  for (const h of headings) {
    if (h.level === 1) {
      h1Count += 1;
      if (h1Count > 1) {
        violations.push({
          kind: "multiple-h1",
          message: `Multiple <h1> in a single document (line ${h.line}).`,
          heading: h,
        });
      }
    }
    if (lastLevel > 0 && h.level > lastLevel + 1) {
      violations.push({
        kind: "skipped-level",
        message: `Heading jumps from h${lastLevel} to h${h.level} at line ${h.line}.`,
        heading: h,
      });
    }
    lastLevel = h.level;
  }
  return violations;
}

const ATX = /^(#{1,6})\s+(.+?)\s*#*\s*$/;
const SETEXT_LINE = /^(=+|-+)\s*$/;

/**
 * Minimal CommonMark heading scan that's deliberately small — the production
 * renderer will hand us a full AST, but having a string-only fallback keeps
 * the validator usable from CI and from the hardcoded-strings linter.
 */
export function scanHeadings(markdown: string): ParsedHeading[] {
  const lines = markdown.split(/\r?\n/);
  const out: ParsedHeading[] = [];
  let inFence = false;
  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i];
    /* v8 ignore next -- split(/\r?\n/) yields strings for every index 0..length-1 */
    if (line === undefined) continue;
    if (/^```|^~~~/.test(line)) {
      inFence = !inFence;
      continue;
    }
    if (inFence) continue;
    const atx = line.match(ATX);
    if (atx) {
      /* v8 ignore next 2 -- both capture groups of ATX are non-optional, so atx[1] / atx[2] are always strings */
      const lvl = (atx[1] ?? "").length as 1 | 2 | 3 | 4 | 5 | 6;
      out.push({ level: lvl, text: (atx[2] ?? "").trim(), line: i + 1 });
      continue;
    }
    const next = lines[i + 1];
    if (next && SETEXT_LINE.test(next) && line.trim().length > 0) {
      const level = next.startsWith("=") ? 1 : 2;
      out.push({ level, text: line.trim(), line: i + 1 });
    }
  }
  return out;
}
