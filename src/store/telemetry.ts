import { create } from "zustand";
import { persist } from "zustand/middleware";

export type TelemetryConsent = "enabled" | "disabled" | "unset";

/**
 * Telemetry: the union of events the workspace shell emits. The
 * renderer never owns transport — these are fire-and-forget calls that
 * the host (or a future sink) listens to via `subscribeTelemetry`.
 * Consent gating happens here so individual call sites stay terse.
 *
 * ADR-0019 §Decision.1: the chat/editor dual shell is gone, so the
 * `shell.switched` / `editor.opened_via_escape_hatch` events (which only
 * existed to track the toggle between the two shells) are removed.
 * `shell.mounted` now reports the single `workspace` shell, and the new
 * `shell.chat_toggled` records the Chat panel collapse/expand.
 */
export type TelemetryEvent =
  | { type: "shell.mounted"; shell: "workspace"; workspaceId: string; firstPaintMs: number }
  | { type: "shell.chat_toggled"; open: boolean }
  | {
      type: "chat.message_sent";
      workspaceId: string;
      contextBlocks: string[];
      tokensUsed: number;
      tokensBudget: number;
    }
  | { type: "chat.context_trimmed"; trimmedKinds: string[]; reason: "budget" }
  | { type: "chat.session_created"; workspaceId: string; messageCount: number }
  | { type: "chat.session_resumed"; workspaceId: string; messageCount: number };

interface TelemetryState {
  consent: TelemetryConsent;
  firstRunPromptShown: boolean;
  setConsent: (c: TelemetryConsent) => void;
}

export const useTelemetry = create<TelemetryState>()(
  persist(
    (set) => ({
      consent: "unset",
      firstRunPromptShown: false,
      setConsent: (consent) => set({ consent, firstRunPromptShown: true }),
    }),
    { name: "markspread.telemetry" },
  ),
);

const subscribers = new Set<(evt: TelemetryEvent) => void>();

/**
 * Subscribe to telemetry events. Returns an unsubscriber. Subscribers are
 * called synchronously inside `emitTelemetry`; throwing inside one will
 * not affect others (each is wrapped in try/catch).
 */
export function subscribeTelemetry(fn: (evt: TelemetryEvent) => void): () => void {
  subscribers.add(fn);
  return () => subscribers.delete(fn);
}

/**
 * Fire a telemetry event. No-op when consent is not enabled. Errors in
 * subscribers are logged but never propagate to the caller — telemetry
 * must never break the feature that emits it.
 */
export function emitTelemetry(evt: TelemetryEvent): void {
  if (useTelemetry.getState().consent !== "enabled") return;
  for (const fn of subscribers) {
    try {
      fn(evt);
    } catch (e) {
      console.warn("[telemetry] subscriber failed", e);
    }
  }
}
