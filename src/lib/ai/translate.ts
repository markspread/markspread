// S-AI-009..014: Translate pipeline.
//
// Translate slices the document into deterministic chunks, asks the
// provider for a translation per chunk, and surfaces each result in an
// inline diff so the user can Accept / Reject / Edit per chunk before
// committing. We chunk on paragraph boundaries to keep prompts under model
// context limits without splitting mid-sentence.

export interface TranslateChunk {
  id: string;
  /** 1-based source line range covered by this chunk. */
  startLine: number;
  endLine: number;
  source: string;
  translated?: string;
  /** User decision once they review the diff. `null` = pending. */
  decision: "accept" | "reject" | "edit" | null;
  /** Edited override when `decision === "edit"`. */
  edited?: string;
}

const CHUNK_PARAGRAPH_GROUP = 3; // paragraphs per chunk — small enough to
// fit any model context, large enough to give the model coherent context.

export function chunkDocument(doc: string): TranslateChunk[] {
  const lines = doc.split(/\r?\n/);
  const paragraphs: { start: number; end: number; text: string[] }[] = [];
  let current: { start: number; text: string[] } | null = null;
  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i] as string;
    if (line.trim().length === 0) {
      if (current) {
        paragraphs.push({ start: current.start, end: i, text: current.text });
        current = null;
      }
      continue;
    }
    if (!current) current = { start: i + 1, text: [line] };
    else current.text.push(line);
  }
  if (current) {
    paragraphs.push({ start: current.start, end: lines.length, text: current.text });
  }

  const chunks: TranslateChunk[] = [];
  for (let i = 0; i < paragraphs.length; i += CHUNK_PARAGRAPH_GROUP) {
    const slice = paragraphs.slice(i, i + CHUNK_PARAGRAPH_GROUP);
    const first = slice[0] as (typeof paragraphs)[number];
    const last = slice[slice.length - 1] as (typeof paragraphs)[number];
    const startLine = first.start;
    const endLine = last.end;
    const source = slice.map((p) => p.text.join("\n")).join("\n\n");
    chunks.push({ id: `chunk-${chunks.length}`, startLine, endLine, source, decision: null });
  }
  return chunks;
}

// S-AI-013: code blocks and math should not be translated. We mask them with
// stable placeholders before prompting and restore them after the model
// responds. The placeholder format intentionally avoids whitespace so model
// re-rendering doesn't fold them.
const FENCE = /(^|\n)(```|~~~)([\s\S]*?)\n(\2)(?=\n|$)/g;
const MATH_BLOCK = /\$\$([\s\S]*?)\$\$/g;
const INLINE_CODE = /`([^`\n]+)`/g;
const INLINE_MATH = /\$([^$\n]+)\$/g;

export interface MaskedText {
  masked: string;
  segments: string[];
}

export function maskUntranslatable(text: string): MaskedText {
  const segments: string[] = [];
  function take(match: string): string {
    const idx = segments.length;
    segments.push(match);
    return `MS${idx}`;
  }
  let masked = text.replace(FENCE, (m) => take(m));
  masked = masked.replace(MATH_BLOCK, (m) => take(m));
  masked = masked.replace(INLINE_CODE, (m) => take(m));
  masked = masked.replace(INLINE_MATH, (m) => take(m));
  return { masked, segments };
}

export function unmaskUntranslatable({ segments }: MaskedText, translated: string): string {
  // Use the original `masked` only for cross-check; the translation should
  // contain the same placeholders — if the model dropped one we re-emit it
  // at the position where the model placed the previous placeholder.
  let out = translated;
  for (let i = 0; i < segments.length; i += 1) {
    const placeholder = `MS${i}`;
    const segment = segments[i] as string;
    if (out.includes(placeholder)) {
      out = out.replace(placeholder, () => segment);
    } else {
      // Model lost the marker — append the original segment so no code is
      // silently deleted. The diff UI will surface the discrepancy.
      out += `\n${segment}`;
    }
  }
  return out;
}

/**
 * S-AI-013 verification: returns the placeholder count in source vs
 * translated so the chunk reviewer can warn the user when the model
 * mangled a code fence.
 */
export function comparePlaceholders(
  masked: string,
  modelOutput: string,
): {
  expected: number;
  found: number;
  missing: number[];
} {
  // biome-ignore lint/suspicious/noControlCharactersInRegex: \x01 delimits placeholder markers by design
  const expected = (masked.match(/\x01MS\d+\x01/g) ?? []).length;
  const present = new Set<number>();
  // biome-ignore lint/suspicious/noControlCharactersInRegex: \x01 delimits placeholder markers by design
  for (const m of modelOutput.matchAll(/\x01MS(\d+)\x01/g)) {
    present.add(Number(m[1]));
  }
  const missing: number[] = [];
  for (let i = 0; i < expected; i += 1) {
    if (!present.has(i)) missing.push(i);
  }
  return { expected, found: present.size, missing };
}

/**
 * Build the final translated document from accepted / edited chunks.
 * Rejected chunks keep the source text. The whole operation is wrapped in
 * a single editor transaction by the caller (S-AI-012's "undo once" rule).
 */
export function assembleDocument(originalDoc: string, chunks: TranslateChunk[]): string {
  const lines = originalDoc.split(/\r?\n/);
  // Apply from bottom up so line indices stay stable.
  const ordered = [...chunks].sort((a, b) => b.startLine - a.startLine);
  for (const ch of ordered) {
    if (ch.decision === "accept" && ch.translated !== undefined) {
      lines.splice(
        ch.startLine - 1,
        ch.endLine - ch.startLine + 1,
        ...ch.translated.split(/\r?\n/),
      );
    } else if (ch.decision === "edit" && ch.edited !== undefined) {
      lines.splice(ch.startLine - 1, ch.endLine - ch.startLine + 1, ...ch.edited.split(/\r?\n/));
    }
    // reject / pending → keep original lines
  }
  return lines.join("\n");
}
