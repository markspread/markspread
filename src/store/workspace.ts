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
      open: (path, opts) => set({ current: path, readOnly: opts?.readOnly ?? false }),
      close: () => set({ current: null, readOnly: false }),
      setReadOnly: (v) => set({ readOnly: v }),
    }),
    { name: persistKeyFor("markspread.workspace") },
  ),
);
