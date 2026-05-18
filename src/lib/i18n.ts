export type SupportedLocale = "en" | "ko" | "ja" | "zh" | "es";

export const SUPPORTED_LOCALES: SupportedLocale[] = ["en", "ko", "ja", "zh", "es"];
export const DEFAULT_LOCALE: SupportedLocale = "en";

const EXACT_MATCH: Record<string, SupportedLocale> = {
  "en-US": "en",
  "en-GB": "en",
  "ko-KR": "ko",
  "ja-JP": "ja",
  "zh-CN": "zh",
  "zh-TW": "zh",
  "zh-HK": "zh",
  "es-ES": "es",
  "es-MX": "es",
};

function languagePart(tag: string): string {
  return tag.split(/[-_]/)[0]?.toLowerCase() ?? "";
}

export function pickLocaleFromTags(tags: readonly string[]): SupportedLocale {
  for (const raw of tags) {
    const tag = raw.replace("_", "-");
    const exact = EXACT_MATCH[tag];
    if (exact) return exact;
  }
  for (const raw of tags) {
    const lang = languagePart(raw) as SupportedLocale;
    if (SUPPORTED_LOCALES.includes(lang)) return lang;
  }
  return DEFAULT_LOCALE;
}

export function detectSystemLocale(): SupportedLocale {
  const tags: string[] = [];
  if (typeof navigator !== "undefined") {
    if (Array.isArray(navigator.languages)) tags.push(...navigator.languages);
    if (navigator.language) tags.push(navigator.language);
  }
  return pickLocaleFromTags(tags);
}
