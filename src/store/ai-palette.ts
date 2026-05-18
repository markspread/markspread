// S-AI-001: AiActionPalette open/close state.
//
// The palette itself is a presentational component (props-driven). This
// store is the host-side glue so a keyboard chord or a Settings link can
// flip it open from anywhere without prop-drilling.

import { create } from "zustand";
import type { ActionContext } from "../lib/ai/actions";

const EMPTY_CONTEXT: ActionContext = {
  hasSelection: false,
  documentLength: 0,
  inCodeBlock: false,
};

interface AiPaletteState {
  open: boolean;
  context: ActionContext;
  openPalette: (context?: ActionContext) => void;
  close: () => void;
}

export const useAiPalette = create<AiPaletteState>((set) => ({
  open: false,
  context: EMPTY_CONTEXT,
  openPalette: (context) => set({ open: true, context: context ?? EMPTY_CONTEXT }),
  close: () => set({ open: false }),
}));
