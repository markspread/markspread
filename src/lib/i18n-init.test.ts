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
});
