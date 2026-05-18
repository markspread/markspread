// S-AI-004 / S-AI-005 / S-AI-006 / S-AI-007 / S-AI-008: Review pipeline.
//
// The Review action streams margin comments from the AI provider into a
// CodeMirror state field. Each comment carries:
//   - an anchor (line + column) that the editor remaps as the user edits
//     so the marker sticks with the prose it commented on,
//   - a suggested replacement (optional) that the user can Apply,
//   - a status — pending, applied, dismissed, stale (anchor-line removed).

export type ReviewCommentStatus = "pending" | "applied" | "dismissed" | "stale";

export interface ReviewComment {
  id: string;
  /** 1-based source line at the time the comment was emitted. */
  anchorLine: number;
  /** Optional column offset for sub-line precision. */
  anchorCol?: number;
  /** Human-readable critique. */
  message: string;
  /**
   * Optional suggested replacement. Apply rewrites `[anchorLine, anchorEndLine]`
   * (inclusive) with this string. Without this, the comment is informational.
   */
  suggestion?: {
    text: string;
    /** 1-based line of the last source line covered by the suggestion. */
    anchorEndLine: number;
  };
  status: ReviewCommentStatus;
}

// Streamed events from the provider — we accept either a complete comment
// or a partial-text patch keyed by id so the UI can render incrementally
// (S-AI-004's "first comment <800ms" target).
export type ReviewStreamEvent =
  | { type: "comment"; comment: ReviewComment }
  | { type: "delta"; id: string; messageDelta: string }
  | { type: "progress"; line: number }
  | { type: "done" }
  | { type: "error"; message: string };

export interface ApplyResult {
  applied: ReviewComment[];
  skipped: { comment: ReviewComment; reason: "conflict" | "stale" }[];
}

/**
 * Pure helper that takes the document text + the set of pending comments and
 * returns the new document plus a per-comment outcome. The CodeMirror
 * binding (in editor land) wraps this in a single transaction so undo is
 * one keystroke for both single Apply (S-AI-005) and Apply All (S-AI-006).
 *
 * Conflicts are detected when two suggestions overlap on the same line
 * range — the higher-priority (earlier in the array) wins, the loser is
 * reported as skipped.
 */
export function applyComments(
  doc: string,
  comments: ReviewComment[],
): { doc: string; result: ApplyResult } {
  const lines = doc.split(/\r?\n/);
  const lineCount = lines.length;
  const claimedLines = new Set<number>();
  const applied: ReviewComment[] = [];
  const skipped: ApplyResult["skipped"] = [];

  // Apply from the bottom up so earlier line indices stay stable while we
  // splice the array.
  const orderable = comments
    .filter((c) => c.status === "pending" && c.suggestion)
    .sort((a, b) => b.anchorLine - a.anchorLine);

  for (const c of orderable) {
    const start = c.anchorLine;
    const end = c.suggestion!.anchorEndLine;
    if (start < 1 || end > lineCount || start > end) {
      skipped.push({ comment: c, reason: "stale" });
      continue;
    }
    let conflict = false;
    for (let l = start; l <= end; l += 1) {
      if (claimedLines.has(l)) {
        conflict = true;
        break;
      }
    }
    if (conflict) {
      skipped.push({ comment: c, reason: "conflict" });
      continue;
    }
    for (let l = start; l <= end; l += 1) claimedLines.add(l);
    const replacement = c.suggestion!.text.split(/\r?\n/);
    lines.splice(start - 1, end - start + 1, ...replacement);
    applied.push({ ...c, status: "applied" });
  }

  return { doc: lines.join("\n"), result: { applied, skipped } };
}

/**
 * Re-anchor a comment after a document edit. `lineMap` maps old line numbers
 * to new ones (or `null` if the line was removed). Comments whose anchor was
 * removed flip to `stale` so the UI can grey them out — they're never
 * silently dropped, since the user may still want the critique even if the
 * exact line is gone.
 */
export function remapComments(
  comments: ReviewComment[],
  lineMap: (oldLine: number) => number | null,
): ReviewComment[] {
  return comments.map((c) => {
    if (c.status !== "pending") return c;
    const next = lineMap(c.anchorLine);
    if (next === null) return { ...c, status: "stale" };
    const nextEnd = c.suggestion ? lineMap(c.suggestion.anchorEndLine) : null;
    if (c.suggestion && nextEnd === null) return { ...c, status: "stale" };
    const nextSuggestion = c.suggestion && nextEnd !== null
      ? { ...c.suggestion, anchorEndLine: nextEnd }
      : c.suggestion;
    return {
      ...c,
      anchorLine: next,
      ...(nextSuggestion !== undefined && { suggestion: nextSuggestion }),
    };
  });
}
