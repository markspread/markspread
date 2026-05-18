import { create } from "zustand";
import { persist } from "zustand/middleware";

export type TelemetryConsent = "enabled" | "disabled" | "unset";

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
