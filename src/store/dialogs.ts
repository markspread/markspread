// S-MDX-* host surface: open-state for the markdown helper dialogs.
//
// Each markdown dialog (Insert Table / Image / Link) lives at the App
// level so any keybinding or palette command can flip it open without
// prop-drilling through the editor tree. The Export dialog rides the
// same store so the command palette can trigger it the same way.

import { create } from "zustand";

interface DialogsState {
  insertTable: boolean;
  image: boolean;
  link: boolean;
  exportDoc: boolean;
  showInsertTable: () => void;
  hideInsertTable: () => void;
  showImage: () => void;
  hideImage: () => void;
  showLink: () => void;
  hideLink: () => void;
  showExport: () => void;
  hideExport: () => void;
}

export const useDialogs = create<DialogsState>((set) => ({
  insertTable: false,
  image: false,
  link: false,
  exportDoc: false,
  showInsertTable: () => set({ insertTable: true }),
  hideInsertTable: () => set({ insertTable: false }),
  showImage: () => set({ image: true }),
  hideImage: () => set({ image: false }),
  showLink: () => set({ link: true }),
  hideLink: () => set({ link: false }),
  showExport: () => set({ exportDoc: true }),
  hideExport: () => set({ exportDoc: false }),
}));
