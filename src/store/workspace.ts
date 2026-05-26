// ADR-0010 (U1 ChatShell foundation): the workspace store now carries
// `preferredShell` — a per-workspace selection of which shell the user
// sees on first paint. The field is persisted through the same zustand
// `persist` middleware as `current`, so the choice survives reloads
// and follows the workspace across windows that share the persist key.
//
// Default: 'chat'. Migration to v2 of `.markspread/layout.json` writes
// 'editor' for legacy workspaces (see `src/lib/migration/layout-shell.ts`).

import { create } from "zustand";
import { persist } from "zustand/middleware";
import { persistKeyFor } from "../lib/window-id";

export type PreferredShell = "chat" | "editor";

interface WorkspaceState {
  current: string | null;
  readOnly: boolean;
  preferredShell: PreferredShell;
  open: (path: string, opts?: { readOnly?: boolean; preferredShell?: PreferredShell }) => void;
  close: () => void;
  setReadOnly: (v: boolean) => void;
  setPreferredShell: (shell: PreferredShell) => void;
}

export const useWorkspace = create<WorkspaceState>()(
  persist(
    (set) => ({
      current: null,
      readOnly: false,
      preferredShell: "chat",
      open: (path, opts) =>
        set({
          current: path,
          readOnly: opts?.readOnly ?? false,
          preferredShell: opts?.preferredShell ?? "chat",
        }),
      close: () => set({ current: null, readOnly: false }),
      setReadOnly: (v) => set({ readOnly: v }),
      setPreferredShell: (shell) => set({ preferredShell: shell }),
    }),
    { name: persistKeyFor("markspread.workspace") },
  ),
);
