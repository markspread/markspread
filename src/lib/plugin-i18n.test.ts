// S-I18-010: plugin i18n bridge — namespaced bundle registration.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useLocale } from "../store/locale";
import { i18n } from "./i18n-init";
import {
  type PluginLocaleSource,
  registerPluginLocale,
  tForPlugin,
  unregisterPluginLocale,
} from "./plugin-i18n";

beforeEach(() => {
  useLocale.setState({ locale: "en" });
});

afterEach(() => {
  unregisterPluginLocale("p1");
  unregisterPluginLocale("p2");
  useLocale.setState({ locale: "en" });
});

describe("registerPluginLocale / tForPlugin", () => {
  it("loads the active locale bundle and translates from it", async () => {
    const source: PluginLocaleSource = {
      id: "p1",
      load: vi.fn().mockResolvedValue({ greeting: "Hi" }),
    };
    await registerPluginLocale(source);
    expect(source.load).toHaveBeenCalledWith("en");
    expect(tForPlugin("p1", "greeting")).toBe("Hi");
  });

  it("also preloads the default locale when active is non-en", async () => {
    useLocale.setState({ locale: "ko" });
    const load = vi.fn().mockResolvedValue({ k: "v" });
    await registerPluginLocale({ id: "p2", load });
    await Promise.resolve();
    expect(load).toHaveBeenCalledWith("ko");
    expect(load).toHaveBeenCalledWith("en");
  });

  it("ignores a null bundle without registering", async () => {
    const load = vi.fn().mockResolvedValue(null);
    await registerPluginLocale({ id: "p1", load });
    expect(tForPlugin("p1", "missing.key")).toBe("missing.key");
  });

  it("swallows a load that throws", async () => {
    const load = vi.fn().mockRejectedValue(new Error("bad bundle"));
    await expect(registerPluginLocale({ id: "p1", load })).resolves.toBeUndefined();
  });

  it("does not re-load a locale already seen", async () => {
    const load = vi.fn().mockResolvedValue({ x: "y" });
    const source: PluginLocaleSource = { id: "p1", load };
    await registerPluginLocale(source);
    await registerPluginLocale(source);
    expect(load).toHaveBeenCalledTimes(1);
  });
});

describe("unregisterPluginLocale", () => {
  it("removes the plugin's resource bundles", async () => {
    await registerPluginLocale({
      id: "p1",
      load: vi.fn().mockResolvedValue({ greeting: "Hi" }),
    });
    expect(i18n.hasResourceBundle("en", "plugin:p1")).toBe(true);
    unregisterPluginLocale("p1");
    expect(i18n.hasResourceBundle("en", "plugin:p1")).toBe(false);
  });
});

describe("locale subscription", () => {
  it("loads the new locale bundle for registered plugins on locale change", async () => {
    const load = vi.fn().mockResolvedValue({ x: "y" });
    await registerPluginLocale({ id: "p1", load });
    load.mockClear();
    useLocale.setState({ locale: "ja" });
    await Promise.resolve();
    await Promise.resolve();
    expect(load).toHaveBeenCalledWith("ja");
  });
});
