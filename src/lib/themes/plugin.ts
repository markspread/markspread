// S-TH-008: plugin theme activation lifecycle.
//
// A theme plugin packages a `ThemeDefinition` (or several) plus
// optional CSS files. When the plugin is enabled we register the
// definitions; when disabled we unregister and, if the active theme
// was provided by this plugin, fall back to "default-light".

import { applyTheme, getActiveTheme, registerTheme, type ThemeDefinition } from "./registry";

export interface ThemePluginManifest {
  pluginId: string;
  themes: ThemeDefinition[];
  /** Optional URL list of stylesheets to inject into <head>. */
  styles?: string[];
}

interface ActivePlugin {
  unregister: (() => void)[];
  injected: HTMLLinkElement[];
}

const active = new Map<string, ActivePlugin>();

export function activateThemePlugin(manifest: ThemePluginManifest): void {
  if (active.has(manifest.pluginId)) return;
  const unregister: (() => void)[] = [];
  for (const theme of manifest.themes) {
    unregister.push(registerTheme(theme));
  }
  const injected: HTMLLinkElement[] = [];
  for (const url of manifest.styles ?? []) {
    const link = document.createElement("link");
    link.rel = "stylesheet";
    link.href = url;
    link.dataset.msPlugin = manifest.pluginId;
    document.head.appendChild(link);
    injected.push(link);
  }
  active.set(manifest.pluginId, { unregister, injected });
}

export function deactivateThemePlugin(pluginId: string): void {
  const entry = active.get(pluginId);
  if (!entry) return;
  for (const fn of entry.unregister) fn();
  for (const link of entry.injected) link.remove();
  active.delete(pluginId);
  // If the currently active theme came from this plugin (it was
  // unregistered above), fall back to default-light.
  const cur = getActiveTheme();
  applyTheme({ themeId: cur.themeId === "default-light" ? cur.themeId : "default-light" });
}
