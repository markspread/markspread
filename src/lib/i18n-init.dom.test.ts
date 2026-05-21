// S-I18-001/007: i18next bootstrap + dynamic locale loading.

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { useLocale } from "../store/locale";

beforeEach(() => {
  useLocale.setState({ locale: "en" });
});

afterEach(() => {
  useLocale.setState({ locale: "en" });
});

describe("i18n-init", () => {
  it("initializes i18next with the en bundle", async () => {
    const { i18n } = await import("./i18n-init");
    expect(i18n.isInitialized).toBe(true);
    expect(typeof i18n.t).toBe("function");
  });

  it("returns the key itself for an unknown key (parseMissingKeyHandler)", async () => {
    const { i18n } = await import("./i18n-init");
    expect(i18n.t("totally.missing.key.xyz")).toBe("totally.missing.key.xyz");
  });

  it("uses a provided default value over the bare key", async () => {
    const { i18n } = await import("./i18n-init");
    expect(i18n.t("another.missing.key", "Fallback Text")).toBe("Fallback Text");
  });

  it("changes language when loading a cached locale (en)", async () => {
    const { loadLocale, i18n } = await import("./i18n-init");
    await loadLocale("en");
    expect(i18n.language).toBe("en");
  });

  it("loads a non-en locale bundle via dynamic import", async () => {
    const { loadLocale, i18n } = await import("./i18n-init");
    await loadLocale("ko");
    expect(i18n.language).toBe("ko");
    expect(i18n.hasResourceBundle("ko", "translation")).toBe(true);
  });

  it("re-loading a cached locale does not throw", async () => {
    const { loadLocale } = await import("./i18n-init");
    await loadLocale("ko");
    await expect(loadLocale("ko")).resolves.toBeUndefined();
  });

  it("marks missing-key fallbacks with the [en] prefix in non-en locales", async () => {
    const { loadLocale, i18n } = await import("./i18n-init");
    await loadLocale("ko");
    // A key that exists in en but not in ko falls back via the postProcessor.
    const r = i18n.t("__definitely.missing.fallback__", { defaultValue: "Hello" });
    expect(r).toBe("[en] Hello");
    // A key that exists in the active locale skips the [en] marker.
    i18n.addResourceBundle("ko", "translation", { exists_in_ko: "있음" }, true, true);
    expect(i18n.t("exists_in_ko")).toBe("있음");
    await loadLocale("en");
  });

  it("dynamically loads the es locale bundle", async () => {
    const { loadLocale, i18n } = await import("./i18n-init");
    await loadLocale("es");
    expect(i18n.hasResourceBundle("es", "translation")).toBe(true);
  });

  it("force-reloads the en bundle through the dynamic-import path", async () => {
    const { loadLocale, i18n } = await import("./i18n-init");
    await loadLocale("en", { force: true });
    expect(i18n.hasResourceBundle("en", "translation")).toBe(true);
  });

  it("dynamically loads the zh locale bundle", async () => {
    const { loadLocale, i18n } = await import("./i18n-init");
    await loadLocale("zh");
    expect(i18n.hasResourceBundle("zh", "translation")).toBe(true);
  });

  it("swallows errors from a missing locale bundle", async () => {
    const { loadLocale } = await import("./i18n-init");
    // 'zz' isn't a real bundle — dynamic import rejects, but loadLocale resolves.
    await expect(
      loadLocale("zz" as unknown as Parameters<typeof loadLocale>[0]),
    ).resolves.toBeUndefined();
  });

  it("re-loads the locale bundle when the locale store changes", async () => {
    const { i18n } = await import("./i18n-init");
    useLocale.setState({ locale: "ja" });
    // Wait for the subscription's async loadLocale + lang update to settle.
    for (let i = 0; i < 50 && document.documentElement.lang !== "ja"; i++) {
      await new Promise((r) => setTimeout(r, 5));
    }
    expect(document.documentElement.lang).toBe("ja");
    expect(i18n.hasResourceBundle("ja", "translation")).toBe(true);
  });
});
