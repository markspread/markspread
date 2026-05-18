import { create } from "zustand";
import { persist } from "zustand/middleware";

export type TourStep =
  | "filetree"
  | "editor"
  | "spread"
  | "ai"
  | "command-palette";

export const TOUR_STEPS: TourStep[] = [
  "filetree",
  "editor",
  "spread",
  "ai",
  "command-palette",
];

interface OnboardingState {
  welcomeBannerDismissed: boolean;
  tourCompleted: boolean;
  tourStep: number | null;
  shortcutHintDismissed: boolean;
  dismissBanner: () => void;
  resetBanner: () => void;
  startTour: () => void;
  nextTourStep: () => void;
  endTour: (completed: boolean) => void;
  dismissShortcutHint: () => void;
}

export const useOnboarding = create<OnboardingState>()(
  persist(
    (set, get) => ({
      welcomeBannerDismissed: false,
      tourCompleted: false,
      tourStep: null,
      shortcutHintDismissed: false,
      dismissBanner: () => set({ welcomeBannerDismissed: true }),
      resetBanner: () =>
        set({ welcomeBannerDismissed: false, tourCompleted: false }),
      startTour: () => set({ tourStep: 0, welcomeBannerDismissed: true }),
      nextTourStep: () => {
        const cur = get().tourStep;
        if (cur === null) return;
        if (cur + 1 >= TOUR_STEPS.length) {
          set({ tourStep: null, tourCompleted: true });
        } else {
          set({ tourStep: cur + 1 });
        }
      },
      endTour: (completed) =>
        set({ tourStep: null, tourCompleted: completed }),
      dismissShortcutHint: () => set({ shortcutHintDismissed: true }),
    }),
    { name: "markspread.onboarding" },
  ),
);
