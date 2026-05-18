// S-ST-001: open/close state for the global Settings sheet. Lives in a tiny
// store (rather than React props) so the gear button, the Cmd+, shortcut, and
// the command palette can all toggle it without prop-drilling through Main.

import { create } from "zustand";

interface SettingsSheetState {
  open: boolean;
  show: () => void;
  hide: () => void;
  toggle: () => void;
}

export const useSettingsSheet = create<SettingsSheetState>((set) => ({
  open: false,
  show: () => set({ open: true }),
  hide: () => set({ open: false }),
  toggle: () => set((s) => ({ open: !s.open })),
}));
