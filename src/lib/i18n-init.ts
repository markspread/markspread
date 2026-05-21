import i18n from "i18next";
import { initReactI18next } from "react-i18next";
import en from "../locales/en.json";
import { useLocale } from "../store/locale";
import { DEFAULT_LOCALE, type SupportedLocale } from "./i18n";

/**
 * S-I18-001: i18next bootstrap. We initialize synchronously with the en
 * bundle inlined (so the first paint never suspends) and the locale picked
 * by S-FL-022 / detect-system-locale. Other locales arrive via dynamic
 * import in `loadLocale` so we don't ship five JSONs to every user.
 */
const cachedBundles: Partial<Record<SupportedLocale, true>> = { en: true };

// S-I18-009: dev-only marker for keys that fell back to en. The post-processor
// runs on every `t()` result; it only prefixes when the active locale isn't
// en and the key is missing from that locale's bundle (so en supplied the
// value via fallbackLng). Production builds skip the registration entirely so
// no marker overhead reaches users.
const IS_DEV =
  typeof import.meta !== "undefined" &&
  Boolean((import.meta as { env?: { DEV?: boolean } }).env?.DEV);
if (IS_DEV) {
  i18n.use({
    type: "postProcessor",
    name: "devMarker",
    process(value: string, keys: string | string[]) {
      const active = i18n.language;
      /* v8 ignore next -- i18n.language is always set after init, so the !active branch never fires */
      if (!active || active === "en") return value;
      /* v8 ignore next 2 -- i18next normalises keys to string before invoking postProcessors; array form is defensive */
      const key = Array.isArray(keys) ? keys[0] : keys;
      if (typeof key !== "string") return value;
      if (i18n.exists(key, { lng: active })) return value;
      return `[en] ${value}`;
    },
  });
}

// S-I18-008: partial translation fallback to en. i18next resolves a key in
// this order — active language → fallbackLng (en) → parseMissingKeyHandler.
// `returnEmptyString: false` and `returnNull: false` make empty / null
// translations also fall through to the en bundle so a half-translated locale
// never shows blank UI. parseMissingKeyHandler is the final escape hatch and
// only fires when the key is absent from BOTH the active locale and en —
// during the migration from string literals to `t()` it returns the key so
// existing call sites keep rendering their pre-i18n labels.
void i18n.use(initReactI18next).init({
  resources: { en: { translation: en } },
  lng: useLocale.getState().locale,
  fallbackLng: DEFAULT_LOCALE,
  returnEmptyString: false,
  returnNull: false,
  ...(IS_DEV && { postProcess: ["devMarker"] }),
  // S-I18: 두 번째 인자(default value)를 우선 사용하고, 그것마저 없으면 키 자체를
  // 반환해서 화면이 비지 않게 한다.
  parseMissingKeyHandler: (key: string, defaultValue?: string) =>
    defaultValue && defaultValue !== key ? defaultValue : key,
  interpolation: { escapeValue: false },
});

export async function loadLocale(
  locale: SupportedLocale,
  opts: { force?: boolean } = {},
): Promise<void> {
  if (!opts.force && cachedBundles[locale]) {
    if (i18n.language !== locale) await i18n.changeLanguage(locale);
    return;
  }
  try {
    const mod = await import(`../locales/${locale}.json`);
    /* v8 ignore next -- locale JSON modules expose .default via Vite's JSON import; the bare-module fallback is defensive */
    i18n.addResourceBundle(locale, "translation", mod.default ?? mod, true, true);
    cachedBundles[locale] = true;
  } catch {
    // Missing locale bundle — leave the UI on the previous (or fallback)
    // language so the user sees something readable instead of raw keys.
    return;
  }
  await i18n.changeLanguage(locale);
}

// S-I18-007: live locale switch. The locale store is the single source of
// truth; this subscriber reloads the resource bundle (cheap if cached) and
// flips i18next's active language so every `useTranslation()` consumer
// re-renders. We also update `<html lang>` so the browser picks the right
// hyphenation / quote style without a restart. Component state isn't
// unmounted, so any unsaved editor content stays in memory.
useLocale.subscribe((state) => {
  void loadLocale(state.locale).then(() => {
    if (typeof document !== "undefined") {
      document.documentElement.lang = state.locale;
    }
  });
});

// S-I18-010: subscribe() only fires on state *changes*, not on the initial
// state, so the first paint after a fresh boot never triggered loadLocale —
// every non-en locale fell back to the en bundle inlined at init. Kick off the
// initial load explicitly here when the persisted locale isn't en. Component
// re-renders happen as soon as the bundle resolves; the synchronous en bundle
// keeps the very first paint readable in the meantime.
/* v8 ignore next 6 -- module-init boot path: persisted locale is "en" in test envs, so this side effect only runs in user sessions */
{
  const initialLocale = useLocale.getState().locale;
  if (initialLocale !== "en") {
    void loadLocale(initialLocale);
  }
}

export { i18n };
