import { create } from "zustand";
import {
  type ReviewComment,
  type ReviewStreamEvent,
  applyComments,
  remapComments,
} from "../lib/ai/review";

// S-AI-004..008: shared state for the Review session. Stored separately
// from the editor so the margin renderer + the toast progress indicator can
// subscribe independently.

interface ReviewProgress {
  /** Last source line the provider reported it had analysed. */
  line: number;
  /** Wall-clock when the stream started — used to surface "1.2s" tooltip. */
  startedAt: number;
}

interface ReviewState {
  active: boolean;
  comments: ReviewComment[];
  progress: ReviewProgress | null;
  error: string | null;

  start(): void;
  ingest(event: ReviewStreamEvent): void;
  finish(): void;
  abort(): void;

  applyOne(id: string, doc: string): { doc: string } | null;
  applyAll(doc: string): { doc: string; skippedCount: number } | null;
  dismiss(id: string): void;
  remap(map: (oldLine: number) => number | null): void;
}

export const useReview = create<ReviewState>((set, get) => ({
  active: false,
  comments: [],
  progress: null,
  error: null,

  start() {
    set({ active: true, comments: [], progress: { line: 0, startedAt: Date.now() }, error: null });
  },

  ingest(event) {
    const state = get();
    if (event.type === "comment") {
      set({ comments: [...state.comments, event.comment] });
    } else if (event.type === "delta") {
      set({
        comments: state.comments.map((c) =>
          c.id === event.id ? { ...c, message: c.message + event.messageDelta } : c,
        ),
      });
    } else if (event.type === "progress") {
      set({ progress: state.progress ? { ...state.progress, line: event.line } : null });
    } else if (event.type === "error") {
      set({ active: false, error: event.message });
    } else if (event.type === "done") {
      set({ active: false });
    }
  },

  finish() {
    set({ active: false });
  },

  abort() {
    set({ active: false, progress: null });
  },

  applyOne(id, doc) {
    const target = get().comments.find((c) => c.id === id);
    if (!target || !target.suggestion || target.status !== "pending") return null;
    const { doc: nextDoc } = applyComments(doc, [target]);
    set({
      comments: get().comments.map((c) => (c.id === id ? { ...c, status: "applied" } : c)),
    });
    return { doc: nextDoc };
  },

  applyAll(doc) {
    const pending = get().comments.filter((c) => c.status === "pending");
    if (pending.length === 0) return null;
    const { doc: nextDoc, result } = applyComments(doc, pending);
    const appliedIds = new Set(result.applied.map((c) => c.id));
    set({
      comments: get().comments.map((c) => (appliedIds.has(c.id) ? { ...c, status: "applied" } : c)),
    });
    return { doc: nextDoc, skippedCount: result.skipped.length };
  },

  dismiss(id) {
    set({
      comments: get().comments.map((c) => (c.id === id ? { ...c, status: "dismissed" } : c)),
    });
  },

  remap(map) {
    set({ comments: remapComments(get().comments, map) });
  },
}));
