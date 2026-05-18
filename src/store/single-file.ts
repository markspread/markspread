import { create } from "zustand";

export interface SingleFileState {
  path: string | null;
  content: string;
  dirty: boolean;
  open: (path: string, content: string) => void;
  setContent: (content: string) => void;
  markSaved: () => void;
  close: () => void;
}

export const useSingleFile = create<SingleFileState>()((set) => ({
  path: null,
  content: "",
  dirty: false,
  open: (path, content) => set({ path, content, dirty: false }),
  setContent: (content) => set({ content, dirty: true }),
  markSaved: () => set({ dirty: false }),
  close: () => set({ path: null, content: "", dirty: false }),
}));
