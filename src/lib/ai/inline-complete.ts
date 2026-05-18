// S-AI-025 / S-AI-026: inline completion (ghost text).
//
// Inline completion is opt-in (off by default — sensitive content shouldn't
// leak to the provider unsolicited). When enabled, the editor pulls a
// suggestion after a debounce of idle keystrokes; the suggestion is rendered
// as ghost text after the cursor. Tab accepts, Esc rejects.

import { create } from "zustand";

export interface InlineSuggestion {
  /** Unique stream id so stale suggestions can be discarded on accept. */
  id: string;
  /** Text to render after the cursor. */
  text: string;
  /** Cursor position the suggestion was anchored to (offset in document). */
  anchorOffset: number;
}

interface InlineCompleteState {
  enabled: boolean;
  suggestion: InlineSuggestion | null;
  setEnabled(enabled: boolean): void;
  show(suggestion: InlineSuggestion): void;
  /** Returns the accepted text and clears the suggestion. */
  accept(): InlineSuggestion | null;
  /** S-AI-026: Esc rejects without accepting. */
  reject(): void;
  /** Clear when the cursor moves elsewhere or the document changes. */
  invalidate(): void;
}

export const useInlineComplete = create<InlineCompleteState>((set, get) => ({
  enabled: false,
  suggestion: null,
  setEnabled(enabled) { set({ enabled, suggestion: enabled ? get().suggestion : null }); },
  show(suggestion) {
    if (!get().enabled) return;
    set({ suggestion });
  },
  accept() {
    const s = get().suggestion;
    set({ suggestion: null });
    return s;
  },
  reject() { set({ suggestion: null }); },
  invalidate() { set({ suggestion: null }); },
}));

// Debounce helper — the editor uses this to wait for an idle pause before
// requesting a suggestion. 600ms is conservative; tighter than 400ms and we
// fire on every keystroke, looser than 800ms and the suggestion arrives
// after the user has already moved on.
export const INLINE_COMPLETE_DEBOUNCE_MS = 600;
