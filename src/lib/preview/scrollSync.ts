// S-PR-010 / S-PR-011: bidirectional scroll sync between editor and
// preview, with a kill-switch.
//
// Strategy: each side reports a fractional "where the viewport top
// sits in document coords" via a small registry; the *other* side
// listens to those fractions and scrolls to match. To keep the two
// halves from feedback-looping we tag transactions with an `origin`
// sentinel so the listener ignores echoes for ~80ms after applying.
//
// We deliberately use line-anchor mapping when the host can supply
// one — `data-source-line` attributes on rendered blocks let the
// preview compute "where would line N land?" instead of relying on
// percentages, which is jumpy on docs with many code blocks.

export type ScrollSide = "editor" | "preview";

export interface ScrollSyncEvent {
  side: ScrollSide;
  /** Source line nearest to the viewport top (1-based). */
  topLine: number;
  /** Fractional fallback when topLine isn't computable. */
  fraction: number;
}

type Listener = (e: ScrollSyncEvent) => void;
const listeners = new Set<Listener>();

let enabled = true;
let suppressUntil = 0;

export function setScrollSyncEnabled(on: boolean): void {
  enabled = on;
}
export function isScrollSyncEnabled(): boolean {
  return enabled;
}

export function emitScroll(e: ScrollSyncEvent): void {
  if (!enabled) return;
  if (Date.now() < suppressUntil) return;
  for (const l of listeners) l(e);
}

export function onScroll(fn: Listener): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

/** Suppress the next ~80ms of emitted events. The receiving side
 * calls this right before scrolling itself so the resulting scroll
 * event doesn't echo back into the sender. */
export function suppressEcho(ms = 80): void {
  suppressUntil = Math.max(suppressUntil, Date.now() + ms);
}
