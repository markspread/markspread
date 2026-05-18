// S-MD-047/048/049: YAML frontmatter helpers.
//
// We parse the leading `---\n…\n---\n` block of a markdown doc into
// a plain key/value map. The parser handles the common cases —
// scalars, quoted strings, simple lists, comments — without pulling
// in a YAML dependency. Anything fancier (anchors, multi-line
// blocks) bails to a string value and the host is free to swap in a
// real parser later.
//
// Exports:
//   • parseFrontmatter(doc) → { fm, body, range } | null
//   • frontmatterFoldRange(state) — the range to fold (S-MD-048)
//   • extractTitle(fm) — first of `title`, `name`, fallback ""
//     (S-MD-049 wires this into the OS window title)

const FENCE_RE = /^---\s*\r?\n([\s\S]*?)\r?\n---\s*(?:\r?\n|$)/;

export interface FrontmatterParseResult {
  fm: Record<string, unknown>;
  body: string;
  /** Absolute char offsets — useful for fold/highlight wiring. */
  range: { from: number; to: number };
}

export function parseFrontmatter(doc: string): FrontmatterParseResult | null {
  const m = FENCE_RE.exec(doc);
  if (!m) return null;
  const yaml = m[1] ?? "";
  const matched = m[0];
  const fm = parseSimpleYaml(yaml);
  return {
    fm,
    body: doc.slice(matched.length),
    range: { from: 0, to: matched.length },
  };
}

export function extractTitle(fm: Record<string, unknown>): string {
  for (const key of ["title", "name"] as const) {
    const v = fm[key];
    if (typeof v === "string" && v.trim()) return v.trim();
  }
  return "";
}

function unquote(value: string): string {
  const v = value.trim();
  if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) {
    return v.slice(1, -1);
  }
  return v;
}

function parseSimpleYaml(text: string): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  const lines = text.split(/\r?\n/);
  let i = 0;
  while (i < lines.length) {
    const raw = lines[i];
    if (raw === undefined || !raw.trim() || raw.trim().startsWith("#")) {
      i++;
      continue;
    }
    const kv = /^([^\s:][^:]*):\s*(.*)$/.exec(raw);
    if (!kv) {
      i++;
      continue;
    }
    const key = (kv[1] ?? "").trim();
    const valueRaw = kv[2] ?? "";
    if (valueRaw.trim() === "") {
      // Could be a list or nested map starting on next line.
      const collected: unknown[] = [];
      let j = i + 1;
      while (j < lines.length && /^\s*-\s+/.test(lines[j] ?? "")) {
        collected.push(unquote((lines[j] ?? "").replace(/^\s*-\s+/, "")));
        j++;
      }
      if (collected.length > 0) {
        out[key] = collected;
        i = j;
        continue;
      }
      out[key] = "";
      i++;
      continue;
    }
    if (valueRaw.trim().startsWith("[") && valueRaw.trim().endsWith("]")) {
      const inner = valueRaw.trim().slice(1, -1);
      out[key] = inner
        .split(",")
        .map((s) => unquote(s.trim()))
        .filter(Boolean);
      i++;
      continue;
    }
    out[key] = unquote(valueRaw);
    i++;
  }
  return out;
}
