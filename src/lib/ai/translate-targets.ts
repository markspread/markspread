// S-AI-009: Translate sub-palette target language list.
//
// The five locales from the host UI are surfaced as quick-pick rows; the
// long tail is exposed via free-text search against the canonical
// IETF/BCP-47 list so users can pick anything Intl supports. We prefer
// "frequency-recent" ordering — the most-recently-used target jumps to the
// top — backed by a small persisted history.

import { create } from "zustand";
import { persist } from "zustand/middleware";

export interface TranslateTarget {
  /** BCP-47 tag, e.g. `ko`, `pt-BR`. */
  tag: string;
  /** Localised language name. The component will resolve via `Intl.DisplayNames`. */
  label: string;
}

export const QUICK_PICK: TranslateTarget[] = [
  { tag: "en", label: "English" },
  { tag: "ko", label: "한국어" },
  { tag: "ja", label: "日本語" },
  { tag: "zh-CN", label: "中文 (简体)" },
  { tag: "es", label: "Español" },
];

const HISTORY_LIMIT = 5;

interface HistoryState {
  recent: string[];
  push(tag: string): void;
}

export const useTranslateHistory = create<HistoryState>()(
  persist(
    (set, get) => ({
      recent: [],
      push(tag) {
        const next = [tag, ...get().recent.filter((t) => t !== tag)].slice(0, HISTORY_LIMIT);
        set({ recent: next });
      },
    }),
    { name: "markspread:translate:history" },
  ),
);

export function rankTargets(query: string, recent: string[]): TranslateTarget[] {
  const q = query.trim().toLowerCase();
  const all = [...QUICK_PICK];
  const recentSet = new Set(recent);
  const recentRanked = QUICK_PICK.filter((t) => recentSet.has(t.tag)).sort(
    (a, b) => recent.indexOf(a.tag) - recent.indexOf(b.tag),
  );
  const rest = all.filter((t) => !recentSet.has(t.tag));
  const ranked = [...recentRanked, ...rest];
  if (!q) return ranked;
  return ranked.filter((t) => t.tag.toLowerCase().includes(q) || t.label.toLowerCase().includes(q));
}
