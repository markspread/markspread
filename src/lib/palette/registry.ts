// S-CP-001..014: command-palette data layer.
//
// We keep the React component thin: it calls into this module for
// the visible item list, fuzzy match, and recency tracking. That way
// other layers (keymap, plug-ins) can register entries without
// importing React.
//
// Categories (S-CP-004): file, command, ai, settings, plugin, help.
// Mode prefixes (S-CP-011/012): `>` filters to commands, `?` filters
// to help — both implemented as a `category` filter inside `query()`.

export type PaletteCategory = "file" | "command" | "ai" | "settings" | "plugin" | "help";

export interface PaletteItem {
  id: string;
  category: PaletteCategory;
  /** Plain-text label shown in the list. */
  label: string;
  /** Optional secondary text (e.g. file path). */
  detail?: string;
  /** Tooltip / help text (S-CP-013). */
  description?: string;
  /** Pretty key chord, e.g. "⌘K" (S-CP-006). */
  shortcut?: string;
  /** Pre-computed lower-case search target. */
  searchKey?: string;
  /** Custom score boost applied after fuzzy matching. */
  weight?: number;
  /** Side effect to run on Enter (S-CP-007). */
  run: () => void | Promise<void>;
}

const items = new Map<string, PaletteItem>();
const recents: { id: string; ts: number }[] = []; // newest-first
const RECENT_CAP = 50;

export function registerPaletteItem(item: PaletteItem): () => void {
  items.set(item.id, {
    ...item,
    searchKey: (item.searchKey ?? `${item.label} ${item.detail ?? ""}`).toLowerCase(),
  });
  return () => {
    items.delete(item.id);
  };
}

export function clearPaletteItems(): void {
  items.clear();
}

export interface QueryOptions {
  /** Full text typed by the user (with prefix). */
  raw: string;
  /** Cap the list size (default 50). */
  limit?: number;
}

interface ParsedQuery {
  category: PaletteCategory | "any";
  query: string;
}

function parseQuery(raw: string): ParsedQuery {
  const trimmed = raw.trim();
  if (trimmed.startsWith(">")) {
    return { category: "command", query: trimmed.slice(1).trim() };
  }
  if (trimmed.startsWith("?")) {
    return { category: "help", query: trimmed.slice(1).trim() };
  }
  return { category: "any", query: trimmed };
}

export function query(opts: QueryOptions): PaletteItem[] {
  const { raw, limit = 50 } = opts;
  const parsed = parseQuery(raw);
  const all = Array.from(items.values()).filter(
    (it) => parsed.category === "any" || it.category === parsed.category,
  );
  // S-CP-010: empty query → top recents (5 by default; we still
  // honour `limit` if the caller asked for more).
  if (parsed.query === "") {
    const recentIds = recents.slice(0, Math.min(limit, 5)).map((r) => r.id);
    const recentItems = recentIds
      .map((id) => items.get(id))
      .filter((x): x is PaletteItem => Boolean(x));
    if (recentItems.length > 0) return recentItems;
    return all.slice(0, limit);
  }
  const scored = all.map((it) => {
    /* v8 ignore next -- registerPaletteItem always populates searchKey, so the fallback never triggers */
    const score = fuzzyScore(it.searchKey ?? it.label.toLowerCase(), parsed.query.toLowerCase());
    return { it, score };
  });
  return scored
    .filter((x) => x.score > Number.NEGATIVE_INFINITY)
    .map((x) => ({
      ...x,
      score: x.score + (x.it.weight ?? 0) + recencyBoost(x.it.id),
    }))
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)
    .map((x) => x.it);
}

export function noteUsed(id: string): void {
  const idx = recents.findIndex((r) => r.id === id);
  if (idx !== -1) recents.splice(idx, 1);
  recents.unshift({ id, ts: Date.now() });
  if (recents.length > RECENT_CAP) recents.length = RECENT_CAP;
}

function recencyBoost(id: string): number {
  const idx = recents.findIndex((r) => r.id === id);
  if (idx === -1) return 0;
  // Most-recent => +5, decaying linearly across the top 10 entries.
  return Math.max(0, 5 - idx * 0.5);
}

// S-CP-003: subsequence fuzzy matcher with a prefix bonus.
//
// Score model:
//   • +3 per matched character that follows another match (run).
//   • +5 if the match starts at the haystack's first character.
//   • -1 per skipped character between matches.
//   • +6 if every needle character matched.
//   • -Infinity if any needle char is missing.
export function fuzzyScore(haystack: string, needle: string): number {
  if (needle.length === 0) return 0;
  let i = 0;
  let score = 0;
  let lastMatch = -2;
  for (let j = 0; j < haystack.length && i < needle.length; j++) {
    if (haystack[j] === needle[i]) {
      score += j === 0 && i === 0 ? 5 : 1;
      if (j === lastMatch + 1) score += 3;
      lastMatch = j;
      i++;
    }
  }
  if (i < needle.length) return Number.NEGATIVE_INFINITY;
  score += 6;
  // Penalise skipped characters.
  score -= haystack.length - lastMatch - 1;
  return score;
}
