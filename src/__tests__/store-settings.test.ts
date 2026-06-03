// Unit tests for the typography/behaviour settings store, including the
// clamp helpers and preset-validation branches.

import { beforeEach, describe, expect, it } from "vitest";
import {
  FONT_SIZE_DEFAULT,
  FONT_SIZE_MAX,
  FONT_SIZE_MIN,
  FONT_WEIGHT_DEFAULT,
  LETTER_SPACING_DEFAULT,
  LETTER_SPACING_MAX,
  LETTER_SPACING_MIN,
  LINE_HEIGHT_DEFAULT,
  clampFontSize,
  clampLetterSpacing,
  useSettings,
} from "../store/settings";

beforeEach(() => {
  useSettings.setState({
    autosaveOnClose: true,
    previewTabsEnabled: true,
    uiFontFamily: "",
    editorFontFamily: "",
    fontSizePx: FONT_SIZE_DEFAULT,
    lineHeight: LINE_HEIGHT_DEFAULT,
    letterSpacingPx: LETTER_SPACING_DEFAULT,
    fontWeight: FONT_WEIGHT_DEFAULT,
  });
});

describe("clampFontSize", () => {
  it("clamps below the minimum", () => {
    expect(clampFontSize(2)).toBe(FONT_SIZE_MIN);
  });
  it("clamps above the maximum", () => {
    expect(clampFontSize(99)).toBe(FONT_SIZE_MAX);
  });
  it("rounds fractional values", () => {
    expect(clampFontSize(14.6)).toBe(15);
  });
  it("falls back to the default for non-finite input", () => {
    expect(clampFontSize(Number.NaN)).toBe(FONT_SIZE_DEFAULT);
    expect(clampFontSize(Number.POSITIVE_INFINITY)).toBe(FONT_SIZE_DEFAULT);
  });
});

describe("clampLetterSpacing", () => {
  it("clamps below the minimum", () => {
    expect(clampLetterSpacing(-5)).toBe(LETTER_SPACING_MIN);
  });
  it("clamps above the maximum", () => {
    expect(clampLetterSpacing(5)).toBe(LETTER_SPACING_MAX);
  });
  it("rounds to 0.1px steps", () => {
    expect(clampLetterSpacing(0.44)).toBe(0.4);
  });
  it("falls back to the default for non-finite input", () => {
    expect(clampLetterSpacing(Number.NaN)).toBe(LETTER_SPACING_DEFAULT);
  });
});

describe("settings store", () => {
  it("setAutosaveOnClose toggles the flag", () => {
    useSettings.getState().setAutosaveOnClose(false);
    expect(useSettings.getState().autosaveOnClose).toBe(false);
  });

  it("setPreviewTabsEnabled toggles the flag", () => {
    useSettings.getState().setPreviewTabsEnabled(false);
    expect(useSettings.getState().previewTabsEnabled).toBe(false);
  });

  it("setDeveloperMode toggles the ADR-0019 T5 Parser Studio gate flag", () => {
    expect(useSettings.getState().developerMode).toBe(false);
    useSettings.getState().setDeveloperMode(true);
    expect(useSettings.getState().developerMode).toBe(true);
    useSettings.getState().setDeveloperMode(false);
    expect(useSettings.getState().developerMode).toBe(false);
  });

  it("setUiFontFamily stores the raw value", () => {
    useSettings.getState().setUiFontFamily("Comic Sans");
    expect(useSettings.getState().uiFontFamily).toBe("Comic Sans");
  });

  it("setEditorFontFamily stores the raw value", () => {
    useSettings.getState().setEditorFontFamily("Fira Code");
    expect(useSettings.getState().editorFontFamily).toBe("Fira Code");
  });

  it("setFontSizePx clamps out-of-range input", () => {
    useSettings.getState().setFontSizePx(1000);
    expect(useSettings.getState().fontSizePx).toBe(FONT_SIZE_MAX);
  });

  it("setLineHeight accepts a valid preset", () => {
    useSettings.getState().setLineHeight(1.8);
    expect(useSettings.getState().lineHeight).toBe(1.8);
  });

  it("setLineHeight rejects an invalid value and falls back to default", () => {
    // biome-ignore lint/suspicious/noExplicitAny: deliberately feeding an out-of-union value.
    useSettings.getState().setLineHeight(2.5 as any);
    expect(useSettings.getState().lineHeight).toBe(LINE_HEIGHT_DEFAULT);
  });

  it("setLetterSpacingPx clamps out-of-range input", () => {
    useSettings.getState().setLetterSpacingPx(-100);
    expect(useSettings.getState().letterSpacingPx).toBe(LETTER_SPACING_MIN);
  });

  it("setFontWeight accepts a valid preset", () => {
    useSettings.getState().setFontWeight("light");
    expect(useSettings.getState().fontWeight).toBe("light");
  });

  it("setFontWeight rejects an invalid value and falls back to default", () => {
    // biome-ignore lint/suspicious/noExplicitAny: deliberately feeding an out-of-union value.
    useSettings.getState().setFontWeight("ultrabold" as any);
    expect(useSettings.getState().fontWeight).toBe(FONT_WEIGHT_DEFAULT);
  });
});
