import { create } from "zustand";
import { persist } from "zustand/middleware";
import { type SupportedLocale, detectSystemLocale } from "../lib/i18n";

interface LocaleState {
  locale: SupportedLocale;
  followSystem: boolean;
  setLocale: (locale: SupportedLocale, options?: { manual?: boolean }) => void;
  resetToSystem: () => void;
}

export const useLocale = create<LocaleState>()(
  persist(
    (set) => ({
      locale: detectSystemLocale(),
      followSystem: true,
      setLocale: (locale, options) => set({ locale, followSystem: !options?.manual }),
      resetToSystem: () => set({ locale: detectSystemLocale(), followSystem: true }),
    }),
    {
      name: "markspread.locale",
      onRehydrateStorage: () => (state) => {
        if (state?.followSystem) {
          state.locale = detectSystemLocale();
        }
      },
    },
  ),
);
