// S-PL-017..026: plugin lifecycle — activation, deactivation, contribution
// conflict detection, storage isolation.
//
// Plugins follow a familiar VS Code-style lifecycle:
//
//   register → manifest validated, contribution points indexed
//   activate(ctx) when an activationEvent fires → cleanup hooks pushed onto ctx.subscriptions
//   deactivate() on disable / app exit → ctx.subscriptions disposed
//
// The host owns the lifecycle so plugins can't escape it — there is no
// `process.exit()` equivalent and no path to keep running after deactivate.

import { invoke } from "@tauri-apps/api/core";

export type ActivationEvent =
  | { kind: "language"; language: string }   // S-PL-017: onLanguage:markdown
  | { kind: "command"; command: string }     // S-PL-018: onCommand:my.thing
  | { kind: "view"; view: string }           // S-PL-019: onView:outline
  | { kind: "startup" };                     // S-PL-020: onStartup

export function parseActivationEvent(raw: string): ActivationEvent | null {
  if (raw === "onStartup") return { kind: "startup" };
  if (raw.startsWith("onLanguage:")) return { kind: "language", language: raw.slice("onLanguage:".length) };
  if (raw.startsWith("onCommand:")) return { kind: "command", command: raw.slice("onCommand:".length) };
  if (raw.startsWith("onView:")) return { kind: "view", view: raw.slice("onView:".length) };
  return null;
}

// Check whether a current host signal triggers a plugin's activation.
export interface HostSignal {
  type: "language" | "command" | "view" | "startup";
  /** Language/command/view identifier, ignored when type === "startup". */
  value?: string;
}

export function shouldActivate(events: string[], signal: HostSignal): boolean {
  for (const raw of events) {
    const evt = parseActivationEvent(raw);
    if (!evt) continue;
    if (evt.kind === "startup" && signal.type === "startup") return true;
    if (evt.kind === "language" && signal.type === "language" && evt.language === signal.value) return true;
    if (evt.kind === "command" && signal.type === "command" && evt.command === signal.value) return true;
    if (evt.kind === "view" && signal.type === "view" && evt.view === signal.value) return true;
  }
  return false;
}

// S-PL-021: surface activation errors as a structured event so the
// settings UI can show "this plugin failed to activate — see logs" and
// auto-disable the plugin to prevent boot loops.
export interface ActivationFailure {
  pluginId: string;
  failedAt: number;
  error: string;
  /** Stack from the worker / iframe — already source-mapped if a map shipped with the plugin. */
  stack: string | null;
}

// S-PL-022: the host calls deactivate() on disable / quit / before
// reload; the plugin's cleanup hooks run synchronously within a 2s
// budget. After that the worker is terminated regardless.
export const DEACTIVATE_TIMEOUT_MS = 2_000;

// S-PL-023 / S-PL-024: per-plugin storage namespace + soft quota.
// Storage lives in the SQLite plugin store on the Rust side; the bridge
// scopes every read/write to `plugin:${pluginId}:${key}` so plugins
// can't snoop each other's data.
export const PLUGIN_STORAGE_QUOTA_BYTES = 5 * 1024 * 1024; // 5 MB per plugin

export async function pluginStorageGet(pluginId: string, key: string): Promise<string | null> {
  return invoke<string | null>("plugin_storage_get", { pluginId, key });
}

export async function pluginStorageSet(pluginId: string, key: string, value: string): Promise<void> {
  await invoke("plugin_storage_set", { pluginId, key, value });
}

export async function pluginStorageRemove(pluginId: string, key: string): Promise<void> {
  await invoke("plugin_storage_remove", { pluginId, key });
}

// S-PL-025: ring-buffered log surface per plugin. The host captures
// console.* calls in the sandbox (the worker bootstrap proxies them
// into a postMessage event) so users can open View → Plugin Logs and
// see why a plugin misbehaved without the plugin needing to ship its
// own debug toggle.
export interface PluginLogEntry {
  pluginId: string;
  ts: number;
  level: "log" | "info" | "warn" | "error";
  message: string;
}

export const PLUGIN_LOG_RING_SIZE = 1_000;

// S-PL-026: contribution conflict detection. Two plugins that both
// register `command:tasklist.toggle` collide; we surface the conflict
// at install time (and again at activation) so the user picks which
// plugin owns the contribution. The host then disables the other's
// contribution while keeping the rest of its features alive.
export interface ContributionPoint {
  point: string;     // "commands.toggle-outline"
  pluginId: string;
}

export interface ContributionConflict {
  point: string;
  candidates: string[]; // plugin ids
}

export function detectConflicts(contributions: ContributionPoint[]): ContributionConflict[] {
  const grouped = new Map<string, string[]>();
  for (const c of contributions) {
    const list = grouped.get(c.point) ?? [];
    list.push(c.pluginId);
    grouped.set(c.point, list);
  }
  const out: ContributionConflict[] = [];
  for (const [point, candidates] of grouped) {
    if (candidates.length > 1) out.push({ point, candidates });
  }
  return out;
}
