import { i18n } from "./i18n-init";
import { useLocale } from "../store/locale";
import { DEFAULT_LOCALE, type SupportedLocale } from "./i18n";

// S-I18-010: plugin i18n bridge.
//
// Plugin manifests advertise translation bundles under `locales/<lang>.json`
// (relative to the plugin root). When a plugin is registered we load the
// active locale immediately and subscribe to locale changes so the plugin's
// UI re-translates without reload. Bundles are namespaced per plugin so they
// don't collide with the host app's `translation` namespace.

export interface PluginLocaleSource {
  /** Stable plugin identifier — used as the i18next namespace. */
  id: string;
  /**
   * Resolves a locale bundle URL or pre-parsed JSON for the plugin. The host
   * runtime decides whether `locales/{lang}.json` lives on disk, in an
   * archive, or behind an IPC call — this hook stays transport-agnostic.
   */
  load: (locale: SupportedLocale) => Promise<Record<string, unknown> | null>;
}

const registered = new Map<string, PluginLocaleSource>();
const loadedFor = new Map<string, Set<SupportedLocale>>();

function namespaceFor(id: string): string {
  return `plugin:${id}`;
}

async function ensureLocaleForPlugin(
  source: PluginLocaleSource,
  locale: SupportedLocale,
): Promise<void> {
  const ns = namespaceFor(source.id);
  const seen = loadedFor.get(source.id) ?? new Set<SupportedLocale>();
  if (seen.has(locale)) return;
  try {
    const bundle = await source.load(locale);
    if (bundle) {
      i18n.addResourceBundle(locale, ns, bundle, true, true);
      seen.add(locale);
      loadedFor.set(source.id, seen);
    }
  } catch {
    // Silently ignore — plugin keeps falling back to en (or its raw keys),
    // which is preferable to crashing the host on a malformed bundle.
  }
}

export async function registerPluginLocale(source: PluginLocaleSource): Promise<void> {
  registered.set(source.id, source);
  const active = useLocale.getState().locale;
  await ensureLocaleForPlugin(source, active);
  if (active !== DEFAULT_LOCALE) {
    void ensureLocaleForPlugin(source, DEFAULT_LOCALE);
  }
}

export function unregisterPluginLocale(id: string): void {
  registered.delete(id);
  loadedFor.delete(id);
  const ns = namespaceFor(id);
  for (const lng of i18n.languages ?? []) {
    if (i18n.hasResourceBundle(lng, ns)) {
      i18n.removeResourceBundle(lng, ns);
    }
  }
}

/** Translate a key inside the plugin's namespace, falling back to en. */
export function tForPlugin(id: string, key: string, vars?: Record<string, unknown>): string {
  return i18n.t(key, { ns: namespaceFor(id), ...(vars ?? {}) });
}

// Refresh every registered plugin's bundle when the host locale changes so
// the next render — and any post-process / format helpers the plugin uses —
// pick up the new strings without the plugin having to subscribe itself.
useLocale.subscribe((state) => {
  const next = state.locale;
  for (const source of registered.values()) {
    void ensureLocaleForPlugin(source, next);
  }
});
