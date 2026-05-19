// i18n locale detection / tag matching.

import { describe, expect, it } from "vitest";
import { DEFAULT_LOCALE, SUPPORTED_LOCALES, detectSystemLocale, pickLocaleFromTags } from "./i18n";

describe("constants", () => {
  it("exposes the supported locale set", () => {
    expect(SUPPORTED_LOCALES).toEqual(["en", "ko", "ja", "zh", "es"]);
    expect(DEFAULT_LOCALE).toBe("en");
  });
});

describe("pickLocaleFromTags", () => {
  it("returns an exact-match locale", () => {
    expect(pickLocaleFromTags(["ko-KR"])).toBe("ko");
    expect(pickLocaleFromTags(["zh-TW"])).toBe("zh");
    expect(pickLocaleFromTags(["es-MX"])).toBe("es");
    expect(pickLocaleFromTags(["en-GB"])).toBe("en");
  });

  it("normalises underscores to hyphens for exact match", () => {
    expect(pickLocaleFromTags(["ja_JP"])).toBe("ja");
  });

  it("falls back to the language part when no exact match", () => {
    expect(pickLocaleFromTags(["ko-Hang"])).toBe("ko");
    expect(pickLocaleFromTags(["ja"])).toBe("ja");
  });

  it("returns the default locale when nothing matches", () => {
    expect(pickLocaleFromTags(["fr-FR", "de"])).toBe(DEFAULT_LOCALE);
    expect(pickLocaleFromTags([])).toBe(DEFAULT_LOCALE);
  });

  it("prefers an earlier exact match over a later language match", () => {
    expect(pickLocaleFromTags(["es-ES", "ko"])).toBe("es");
  });

  it("handles empty-string tags gracefully", () => {
    expect(pickLocaleFromTags([""])).toBe(DEFAULT_LOCALE);
  });
});

describe("detectSystemLocale", () => {
  it("derives a locale from navigator (node env: no navigator → default)", () => {
    const result = detectSystemLocale();
    expect(SUPPORTED_LOCALES).toContain(result);
  });
});
