import { create } from "zustand";
import { persist } from "zustand/middleware";

export interface RecentWorkspace {
  path: string;
  lastOpenedMs: number;
}

interface RecentState {
  recent: RecentWorkspace[];
  add: (path: string) => void;
  remove: (path: string) => void;
  clear: () => void;
}

// S-WS-017: spec calls for 20 (LRU). Bumping from the placeholder 10.
const MAX_RECENT = 20;

export const useRecentWorkspaces = create<RecentState>()(
  persist(
    (set) => ({
      recent: [],
      add: (path) =>
        set((s) => {
          const next = [
            { path, lastOpenedMs: Date.now() },
            ...s.recent.filter((w) => w.path !== path),
          ].slice(0, MAX_RECENT);
          return { recent: next };
        }),
      remove: (path) => set((s) => ({ recent: s.recent.filter((w) => w.path !== path) })),
      clear: () => set({ recent: [] }),
    }),
    { name: "markspread.recent-workspaces" },
  ),
);
