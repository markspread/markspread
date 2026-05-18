import { create } from "zustand";
import { persist } from "zustand/middleware";
import type { OpenTab } from "./tabs";

export interface WorkspaceSession {
  tabs: OpenTab[];
  activePath: string | null;
}

interface WorkspaceSessionsState {
  sessions: Record<string, WorkspaceSession>;
  saveSession: (workspace: string, session: WorkspaceSession) => void;
  loadSession: (workspace: string) => WorkspaceSession | null;
  clearSession: (workspace: string) => void;
}

/**
 * S-WS-014: per-workspace persistence of tabs + active path so switching is
 * restorative. Distinct from `useTabs`, which always reflects the
 * currently-open workspace's live state.
 */
export const useWorkspaceSessions = create<WorkspaceSessionsState>()(
  persist(
    (set, get) => ({
      sessions: {},
      saveSession: (workspace, session) =>
        set({ sessions: { ...get().sessions, [workspace]: session } }),
      loadSession: (workspace) => get().sessions[workspace] ?? null,
      clearSession: (workspace) => {
        const next = { ...get().sessions };
        delete next[workspace];
        set({ sessions: next });
      },
    }),
    { name: "markspread.workspace-sessions" },
  ),
);
