import { create } from "zustand";
import { persist } from "zustand/middleware";
import {
  type ResolvedTheme,
  type ThemeMode,
  applyTheme,
  detectSystemTheme,
} from "../lib/theme";

interface ThemeState {
  mode: ThemeMode;
  resolved: ResolvedTheme;
  setMode: (mode: ThemeMode) => void;
  syncFromSystem: () => void;
}

export const useTheme = create<ThemeState>()(
  persist(
    (set, get) => ({
      mode: "system",
      resolved: detectSystemTheme(),
      setMode: (mode) => {
        const resolved = mode === "system" ? detectSystemTheme() : mode;
        applyTheme(resolved);
        set({ mode, resolved });
      },
      syncFromSystem: () => {
        if (get().mode !== "system") return;
        const resolved = detectSystemTheme();
        applyTheme(resolved);
        set({ resolved });
      },
    }),
    {
      name: "markspread.theme",
      onRehydrateStorage: () => (state) => {
        if (!state) return;
        const resolved =
          state.mode === "system" ? detectSystemTheme() : state.mode;
        state.resolved = resolved;
        applyTheme(resolved);
      },
    },
  ),
);

if (typeof window !== "undefined" && window.matchMedia) {
  const media = window.matchMedia("(prefers-color-scheme: dark)");
  media.addEventListener("change", () => {
    useTheme.getState().syncFromSystem();
  });
}
