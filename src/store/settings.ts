import { create } from "zustand";
import { persist } from "zustand/middleware";

interface SettingsState {
  autosaveOnClose: boolean;
  /**
   * S-FT-004: VS Code-style preview tab policy. When true, single-click
   * opens a preview tab (re-used for the next single-click); double-click
   * or Enter pins it.
   */
  previewTabsEnabled: boolean;
  // S-TY-003: empty string means "use the bundled default" (Inter for UI,
  // JetBrains Mono for editor). Anything else is treated as a CSS family
  // name and prepended to the existing font stack.
  uiFontFamily: string;
  editorFontFamily: string;
  // S-TY-004: 12..24 px clamped on read; default 14 stays 1:1 with our
  // Tailwind `text-sm` baseline. Applied to `:root` font-size so `rem`-based
  // sizing scales with the user's choice.
  fontSizePx: number;
  // S-TY-005: line-height presets. Three discrete options instead of a free
  // slider — readability-research literature suggests these three values
  // cover the comfortable range for prose at typical sizes.
  lineHeight: LineHeight;
  // S-TY-006: tracking expressed in pixels for predictability across font
  // sizes. Range -1..+2 covers tightening for display faces and loosening
  // for cramped CJK text without crossing into "wrong" territory.
  letterSpacingPx: number;
  // S-TY-007: three CSS-mappable presets. Variable Inter ships every weight
  // 100..900 so we just emit the numeric value; downstream tooling treats
  // these as the canonical "light / regular / medium" identifiers.
  fontWeight: FontWeight;
  setAutosaveOnClose: (v: boolean) => void;
  setPreviewTabsEnabled: (v: boolean) => void;
  setUiFontFamily: (v: string) => void;
  setEditorFontFamily: (v: string) => void;
  setFontSizePx: (v: number) => void;
  setLineHeight: (v: LineHeight) => void;
  setLetterSpacingPx: (v: number) => void;
  setFontWeight: (v: FontWeight) => void;
}

export type FontWeight = "light" | "regular" | "medium";
export const FONT_WEIGHT_VALUES: Record<FontWeight, number> = {
  light: 300,
  regular: 400,
  medium: 500,
};
export const FONT_WEIGHT_DEFAULT: FontWeight = "regular";

export const LETTER_SPACING_MIN = -1;
export const LETTER_SPACING_MAX = 2;
export const LETTER_SPACING_DEFAULT = 0;
export const clampLetterSpacing = (n: number): number => {
  if (!Number.isFinite(n)) return LETTER_SPACING_DEFAULT;
  // 0.1 px steps so a slider feels smooth without leaking sub-pixel noise.
  const rounded = Math.round(n * 10) / 10;
  return Math.max(LETTER_SPACING_MIN, Math.min(LETTER_SPACING_MAX, rounded));
};

export const FONT_SIZE_MIN = 12;
export const FONT_SIZE_MAX = 24;
export const FONT_SIZE_DEFAULT = 14;
export const clampFontSize = (n: number): number => {
  if (!Number.isFinite(n)) return FONT_SIZE_DEFAULT;
  return Math.max(FONT_SIZE_MIN, Math.min(FONT_SIZE_MAX, Math.round(n)));
};

export type LineHeight = 1.4 | 1.6 | 1.8;
export const LINE_HEIGHTS: LineHeight[] = [1.4, 1.6, 1.8];
export const LINE_HEIGHT_DEFAULT: LineHeight = 1.6;

export const useSettings = create<SettingsState>()(
  persist(
    (set) => ({
      autosaveOnClose: true,
      previewTabsEnabled: true,
      uiFontFamily: "",
      editorFontFamily: "",
      fontSizePx: FONT_SIZE_DEFAULT,
      lineHeight: LINE_HEIGHT_DEFAULT,
      letterSpacingPx: LETTER_SPACING_DEFAULT,
      fontWeight: FONT_WEIGHT_DEFAULT,
      setAutosaveOnClose: (v) => set({ autosaveOnClose: v }),
      setPreviewTabsEnabled: (v) => set({ previewTabsEnabled: v }),
      setUiFontFamily: (v) => set({ uiFontFamily: v }),
      setEditorFontFamily: (v) => set({ editorFontFamily: v }),
      setFontSizePx: (v) => set({ fontSizePx: clampFontSize(v) }),
      setLineHeight: (v) =>
        set({ lineHeight: LINE_HEIGHTS.includes(v) ? v : LINE_HEIGHT_DEFAULT }),
      setLetterSpacingPx: (v) => set({ letterSpacingPx: clampLetterSpacing(v) }),
      setFontWeight: (v) =>
        set({
          fontWeight: v in FONT_WEIGHT_VALUES ? v : FONT_WEIGHT_DEFAULT,
        }),
    }),
    { name: "markspread.settings" },
  ),
);
