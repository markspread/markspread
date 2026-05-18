import { create } from "zustand";
import { persist } from "zustand/middleware";

export type UpdateConsent = "allow" | "deny" | "unset";

interface UpdaterState {
  consent: UpdateConsent;
  firstRunPromptShown: boolean;
  setConsent: (c: UpdateConsent) => void;
  markPromptShown: () => void;
}

export const useUpdater = create<UpdaterState>()(
  persist(
    (set) => ({
      consent: "unset",
      firstRunPromptShown: false,
      setConsent: (consent) => set({ consent, firstRunPromptShown: true }),
      markPromptShown: () => set({ firstRunPromptShown: true }),
    }),
    { name: "markspread.updater" },
  ),
);
