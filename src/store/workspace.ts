// ADR-0019 §Decision.1: the chat/editor dual shell is gone. There is a
// single Workspace shell (FileTree + document + Chat-toggle), so the
// per-workspace `preferredShell` discriminator no longer exists. The
// store now only tracks the open workspace path + its read-only flag,
// persisted through the same zustand `persist` middleware as before so
// `current` survives reloads and follows the workspace across windows
// that share the persist key.

import { create } from "zustand";
import { persist } from "zustand/middleware";
import { persistKeyFor } from "../lib/window-id";

interface WorkspaceState {
  current: string | null;
  readOnly: boolean;
  open: (path: string, opts?: { readOnly?: boolean }) => void;
  close: () => void;
  setReadOnly: (v: boolean) => void;
}

export const useWorkspace = create<WorkspaceState>()(
  persist(
    (set) => ({
      current: null,
      readOnly: false,
      open: (path, opts) =>
        set({
          current: path,
          readOnly: opts?.readOnly ?? false,
        }),
      close: () => set({ current: null, readOnly: false }),
      setReadOnly: (v) => set({ readOnly: v }),
    }),
    { name: persistKeyFor("markspread.workspace") },
  ),
);
