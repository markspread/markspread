// S-PL-020 boot wiring: scan installed plugins on startup and fire the
// onStartup activation signal for those that opt in. The runtime sandbox
// itself (worker / iframe spawn) is owned by the Rust side; the frontend's
// job is to enumerate, surface activation failures, and prompt for any
// outstanding permission grants.
//
// This runs after first paint so it never blocks the editor from mounting.
//
// ADR-0013 + ADR-0016: 본 boot 에서 발견된 각 plugin 을 PluginOrchestrator 의
// TrustRegistry 에 등록 → SettingsPlugins 의 PluginTrustDiagnostics 가 실제
// 데이터로 표시.

import { invoke } from "@tauri-apps/api/core";
import { shouldActivate } from "./lifecycle";
import type { PluginManifest } from "./manifest";
import { getOrchestrator } from "./runtime/orchestrator-singleton";
import type { PluginTrustLevel } from "./runtime/trust-registry";

interface InstalledPlugin {
  manifest: PluginManifest;
  enabled: boolean;
  /** publisher/source hint — if from npm/git, treat as imported. */
  origin?: string;
}

/**
 * 기존 manifest 기반 trust level 추정.
 * - origin 없음 = local (사용자 직접 설치)
 * - 외부 origin (http/github) = imported
 */
function inferTrustLevel(p: InstalledPlugin): PluginTrustLevel {
  if (p.origin && (p.origin.startsWith("http") || p.origin.startsWith("github:"))) {
    return "imported";
  }
  return "local";
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

  const orchestrator = getOrchestrator();
  const now = Date.now();

  for (const plugin of list) {
    const { manifest, enabled } = plugin;
    // Register in orchestrator trust registry (regardless of enabled state —
    // diagnostics panel shows disabled-but-installed plugins too).
    try {
      const level = inferTrustLevel(plugin);
      const opts: { now: number; origin?: string } = { now };
      if (plugin.origin) opts.origin = plugin.origin;
      orchestrator.trust.register(manifest.id, level, opts);
      // Already-installed plugins were accepted at install time → mark consented.
      // 'local' is always-consented by TrustRegistry contract; 'imported' needs explicit call.
      if (level !== "local") {
        orchestrator.trust.recordConsent(manifest.id, now);
      }
    } catch (e) {
      console.warn(`[plugins/boot] trust registration failed: ${manifest.id}`, e);
    }

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
