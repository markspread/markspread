// S-PL-020 boot wiring: scan installed plugins on startup and fire the
// onStartup activation signal for those that opt in. The runtime sandbox
// itself (worker / iframe spawn) is owned by the Rust side; the frontend's
// job is to enumerate, surface activation failures, and prompt for any
// outstanding permission grants.
//
// This runs after first paint so it never blocks the editor from mounting.

import { invoke } from "@tauri-apps/api/core";
import type { PluginManifest } from "./manifest";
import { shouldActivate } from "./lifecycle";

interface InstalledPlugin {
  manifest: PluginManifest;
  enabled: boolean;
}

export async function bootInstalledPlugins(): Promise<void> {
  let list: InstalledPlugin[] = [];
  try {
    list = await invoke<InstalledPlugin[]>("plugin_list");
  } catch (e) {
    // The host may not have the plugins handler wired yet (S-U33). Treat
    // as "no plugins installed" — boot proceeds without raising.
    console.warn("[plugins/boot] plugin_list unavailable", e);
    return;
  }

  for (const { manifest, enabled } of list) {
    if (!enabled) continue;
    if (!shouldActivate(manifest.activationEvents, { type: "startup" })) continue;
    try {
      await invoke("plugin_activate", { pluginId: manifest.id });
    } catch (e) {
      // Auto-disable on activation failure to prevent boot loops (S-PL-021).
      console.warn(`[plugins/boot] activate failed: ${manifest.id}`, e);
      try {
        await invoke("plugin_disable", { pluginId: manifest.id });
      } catch {
        // ignore — surfaces in Settings → Plugins
      }
    }
  }
}
