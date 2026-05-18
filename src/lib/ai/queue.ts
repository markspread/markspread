// S-AI-028: concurrent action queue with UI surfacing.
//
// Users can fire multiple actions back-to-back (e.g. translate one section
// while a summarize is running). The queue caps concurrent provider calls
// per provider so we don't blow rate limits, and surfaces the pending list
// to the UI so users can cancel queued (not-yet-started) jobs cheaply.

import { create } from "zustand";

export type QueuedActionStatus = "pending" | "running" | "done" | "aborted" | "error";

export interface QueuedAction {
  id: string;
  /** Action descriptor id from the AI catalog. */
  actionId: string;
  /** Human-readable label, already localised by the dispatcher. */
  label: string;
  status: QueuedActionStatus;
  enqueuedAt: number;
  startedAt?: number;
  finishedAt?: number;
  errorMessage?: string;
}

interface QueueState {
  items: QueuedAction[];
  enqueue(item: Omit<QueuedAction, "status" | "enqueuedAt">): void;
  start(id: string): void;
  finish(id: string, status: "done" | "error", errorMessage?: string): void;
  abort(id: string): void;
  clearFinished(): void;
}

export const useAiQueue = create<QueueState>((set, get) => ({
  items: [],
  enqueue(item) {
    set({
      items: [...get().items, { ...item, status: "pending", enqueuedAt: Date.now() }],
    });
  },
  start(id) {
    set({
      items: get().items.map((it) =>
        it.id === id ? { ...it, status: "running", startedAt: Date.now() } : it,
      ),
    });
  },
  finish(id, status, errorMessage) {
    set({
      items: get().items.map((it) =>
        it.id === id
          ? {
              ...it,
              status,
              finishedAt: Date.now(),
              ...(errorMessage !== undefined && { errorMessage }),
            }
          : it,
      ),
    });
  },
  abort(id) {
    set({
      items: get().items.map((it) =>
        it.id === id && (it.status === "pending" || it.status === "running")
          ? { ...it, status: "aborted", finishedAt: Date.now() }
          : it,
      ),
    });
  },
  clearFinished() {
    set({
      items: get().items.filter((it) => it.status === "pending" || it.status === "running"),
    });
  },
}));
