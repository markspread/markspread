import { create } from "zustand";
import { persist } from "zustand/middleware";

export type TelemetryConsent = "enabled" | "disabled" | "unset";

/**
 * ADR-0010 Telemetry: the union of events the chat-shell pivot emits.
 * The renderer never owns transport — these are fire-and-forget calls
 * that the host (or a future sink) listens to via `subscribeTelemetry`.
 * Consent gating happens here so individual call sites stay terse.
 */
export type TelemetryEvent =
  | { type: "shell.mounted"; shell: "chat" | "editor"; workspaceId: string; firstPaintMs: number }
  | {
      type: "shell.switched";
      from: "chat" | "editor";
      to: "chat" | "editor";
      trigger: "toolbar" | "palette" | "banner";
    }
  | {
      type: "chat.message_sent";
      workspaceId: string;
      contextBlocks: string[];
      tokensUsed: number;
      tokensBudget: number;
    }
  | { type: "chat.context_trimmed"; trimmedKinds: string[]; reason: "budget" }
  | { type: "chat.session_created"; workspaceId: string; messageCount: number }
  | { type: "chat.session_resumed"; workspaceId: string; messageCount: number }
  | {
      type: "migration.shell_default_applied";
      chosen: "chat" | "editor";
      hadCredentials: boolean;
    }
  | { type: "editor.opened_via_escape_hatch"; from: "chat"; reason: string };

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
