import { useEffect } from "react";
import { useLocale } from "../store/locale";
import {
  FONT_WEIGHT_VALUES,
  clampFontSize,
  clampLetterSpacing,
  useSettings,
} from "../store/settings";

const UI_BASE =
  '"Inter Variable", "Inter", "Pretendard Variable", "Pretendard", system-ui, -apple-system, "Segoe UI", "Helvetica Neue", "Apple SD Gothic Neo", "Noto Sans KR"';
const EDITOR_DEFAULT =
  '"JetBrains Mono Variable", "JetBrains Mono", "SF Mono", "Cascadia Code", "Consolas", "Liberation Mono", monospace';

// S-TY-009: locale-aware CJK fallback tiers. We don't bundle Noto Sans JP /
// SC / TC (each is multi-megabyte) so rely on OS-installed faces with a
// conservative chain. The Traditional Chinese branch is selected only when
// the navigator tag includes a TW/HK region; everything else under "zh"
// resolves to Simplified.
const JP_CHAIN = '"Noto Sans JP", "Hiragino Sans", "Yu Gothic", "Yu Gothic UI", "Meiryo"';
const SC_CHAIN = '"Noto Sans SC", "Noto Sans CJK SC", "PingFang SC", "Microsoft YaHei", "SimHei"';
const TC_CHAIN =
  '"Noto Sans TC", "Noto Sans CJK TC", "PingFang TC", "Microsoft JhengHei", "PMingLiU"';

function chineseRegion(): "TC" | "SC" {
  if (typeof navigator === "undefined") return "SC";
  const tags: string[] = [];
  if (Array.isArray(navigator.languages)) tags.push(...navigator.languages);
  if (navigator.language) tags.push(navigator.language);
  for (const t of tags) {
    const upper = t.toUpperCase();
    if (upper.startsWith("ZH-TW") || upper.startsWith("ZH-HK")) return "TC";
  }
  return "SC";
}

function uiDefaultForLocale(locale: string): string {
  if (locale === "ja") return `${UI_BASE}, ${JP_CHAIN}, sans-serif`;
  if (locale === "zh") {
    const chain = chineseRegion() === "TC" ? TC_CHAIN : SC_CHAIN;
    return `${UI_BASE}, ${chain}, sans-serif`;
  }
  return `${UI_BASE}, sans-serif`;
}

function quote(family: string): string {
  return /[\s"]/.test(family) ? `"${family.replace(/"/g, "")}"` : family;
}

/**
 * S-TY-003: applies the selected UI/editor font families to CSS custom
 * properties live. The store value is prepended to the bundled fallback
 * stack — empty string ⇒ pure default.
 */
export function useFontFamilyEffect(): void {
  const uiFontFamily = useSettings((s) => s.uiFontFamily);
  const editorFontFamily = useSettings((s) => s.editorFontFamily);
  const fontSizePx = useSettings((s) => s.fontSizePx);
  const lineHeight = useSettings((s) => s.lineHeight);
  const letterSpacingPx = useSettings((s) => s.letterSpacingPx);
  const fontWeight = useSettings((s) => s.fontWeight);
  const locale = useLocale((s) => s.locale);
  useEffect(() => {
    const root = document.documentElement;
    const uiDefault = uiDefaultForLocale(locale);
    const ui = uiFontFamily ? `${quote(uiFontFamily)}, ${uiDefault}` : uiDefault;
    const editor = editorFontFamily
      ? `${quote(editorFontFamily)}, ${EDITOR_DEFAULT}`
      : EDITOR_DEFAULT;
    root.style.setProperty("--font-sans", ui);
    root.style.setProperty("--font-mono", editor);
    // S-TY-004: font-size on the root drives `rem`-relative sizing for the
    // entire UI so existing Tailwind text-* classes scale automatically.
    root.style.fontSize = `${clampFontSize(fontSizePx)}px`;
    // S-TY-005: line-height as a unitless multiplier so it tracks font-size.
    root.style.setProperty("--line-height-prose", String(lineHeight));
    root.style.lineHeight = String(lineHeight);
    // S-TY-006: letter-spacing in px applies uniformly. 0 → unset so the
    // browser default kerning kicks back in cleanly.
    const ls = clampLetterSpacing(letterSpacingPx);
    root.style.letterSpacing = ls === 0 ? "" : `${ls}px`;
    // S-TY-007: weight applies to the entire UI body. Bold UI elements
    // (h1, strong, etc.) keep their authored weight via their own selectors.
    root.style.fontWeight = String(FONT_WEIGHT_VALUES[fontWeight] ?? 400);
  }, [uiFontFamily, editorFontFamily, fontSizePx, lineHeight, letterSpacingPx, fontWeight, locale]);
}
