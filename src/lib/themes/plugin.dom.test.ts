// S-TH-008: plugin theme activation lifecycle coverage.

import { beforeEach, describe, expect, it } from "vitest";
import { activateThemePlugin, deactivateThemePlugin } from "./plugin";
import { type ThemeDefinition, applyTheme, getActiveTheme, getTheme } from "./registry";

function makeTheme(id: string): ThemeDefinition {
  return {
    id,
    name: `Theme ${id}`,
    mode: "light",
    light: { tokens: { "--ms-color-bg": "#fff" }, shiki: "github-light" },
  };
}

beforeEach(() => {
  applyTheme({ themeId: "default-light", mode: "system", vision: "default", contrast: "auto" });
  for (const link of Array.from(document.head.querySelectorAll("link[data-ms-plugin]"))) {
    link.remove();
  }
});

describe("activateThemePlugin", () => {
  it("registers all themes from the manifest", () => {
    activateThemePlugin({ pluginId: "p1", themes: [makeTheme("p1-a"), makeTheme("p1-b")] });
    expect(getTheme("p1-a")).toBeDefined();
    expect(getTheme("p1-b")).toBeDefined();
    deactivateThemePlugin("p1");
  });

  it("injects stylesheet links into the document head", () => {
    activateThemePlugin({
      pluginId: "p2",
      themes: [makeTheme("p2-a")],
      styles: ["https://example.com/a.css", "https://example.com/b.css"],
    });
    const links = document.head.querySelectorAll('link[data-ms-plugin="p2"]');
    expect(links).toHaveLength(2);
    expect((links[0] as HTMLLinkElement).rel).toBe("stylesheet");
    deactivateThemePlugin("p2");
  });

  it("is idempotent — re-activating the same plugin id does nothing", () => {
    activateThemePlugin({ pluginId: "p3", themes: [makeTheme("p3-a")], styles: ["x.css"] });
    activateThemePlugin({
      pluginId: "p3",
      themes: [makeTheme("p3-a")],
      styles: ["x.css", "y.css"],
    });
    expect(document.head.querySelectorAll('link[data-ms-plugin="p3"]')).toHaveLength(1);
    deactivateThemePlugin("p3");
  });
});

describe("deactivateThemePlugin", () => {
  it("unregisters themes and removes injected styles", () => {
    activateThemePlugin({ pluginId: "p4", themes: [makeTheme("p4-a")], styles: ["x.css"] });
    deactivateThemePlugin("p4");
    expect(getTheme("p4-a")).toBeUndefined();
    expect(document.head.querySelectorAll('link[data-ms-plugin="p4"]')).toHaveLength(0);
  });

  it("is a no-op for an unknown plugin id", () => {
    expect(() => deactivateThemePlugin("never-registered")).not.toThrow();
  });

  it("falls back to default-light when the active theme came from the plugin", () => {
    activateThemePlugin({ pluginId: "p5", themes: [makeTheme("p5-a")] });
    applyTheme({ themeId: "p5-a" });
    deactivateThemePlugin("p5");
    expect(getActiveTheme().themeId).toBe("default-light");
  });

  it("keeps default-light selected when it was already active", () => {
    applyTheme({ themeId: "default-light" });
    activateThemePlugin({ pluginId: "p6", themes: [makeTheme("p6-a")] });
    deactivateThemePlugin("p6");
    expect(getActiveTheme().themeId).toBe("default-light");
  });
});
