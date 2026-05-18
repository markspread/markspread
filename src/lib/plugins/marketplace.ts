// S-PLM-001..027: plugin marketplace — browse / install / update / verify.
//
// Markspread reuses the npm registry as its plugin distribution channel
// — every plugin is an npm package with a `markspread.json` (or
// `manifest.json`) at the root and a conventional name prefix
// (`markspread-plugin-*` or scope `@markspread-plugins/*`). We don't
// host our own registry; npm is mature, has a strong author identity
// model, and users can swap in a private registry for self-hosted
// distribution.
//
// Install pipeline (S-PLM-009..014):
//
//   1. user clicks Install
//   2. permission consent dialog (manifest perms surfaced verbatim)
//   3. npm tarball download with sha512 verification (S-PLM-011)
//   4. manifest re-validated against the current host version (S-PLM-012)
//   5. extract to ~/.markspread/plugins/<id>@<version>/ (S-PLM-013)
//   6. write entry to plugins.json registry
//   7. fire activation events (S-PLM-014) — onStartup runs immediately

import { invoke } from "@tauri-apps/api/core";
import type { PluginManifest, PluginPermission } from "./manifest";
import { describePermission } from "./permissions";

export type PluginCategory = "parser" | "ai" | "theme" | "command" | "view";

export type Sort = "popular" | "recent" | "rating";

export interface MarketplaceListing {
  id: string;
  name: string;
  publisher: string | null;
  description: string;
  version: string;
  /** S-PLM-005: README rendered to HTML *server-side* and sanitised; null if missing. */
  readmeHtml: string | null;
  /** S-PLM-006: permissions copied from the manifest, surfaced before install. */
  permissions: PluginPermission[];
  /** S-PLM-007: flat dependency list — versioned, with markspread plugin deps annotated. */
  dependencies: { name: string; version: string; isMarkspreadPlugin: boolean }[];
  /** S-PLM-008: SPDX expression — null if unspecified (we treat that as "Unknown"). */
  license: string | null;
  /** S-PLM-027: signed by the official Markspread Ed25519 key. */
  officialBadge: boolean;
  /** Sort fingerprints. */
  weeklyDownloads: number;
  publishedAt: number;
  ratingAverage: number;
  ratingCount: number;
  /** Tarball URL + sha512 for verification (S-PLM-011). */
  dist: { tarball: string; sha512: string };
}

export interface SearchQuery {
  text: string;
  category: PluginCategory | "all";
  sort: Sort;
  /** Allow caller to pin to local cache when the registry is slow (S-PLM-023). */
  preferCache?: boolean;
}

export async function searchMarketplace(query: SearchQuery): Promise<MarketplaceListing[]> {
  return invoke<MarketplaceListing[]>("plugin_marketplace_search", { query });
}

export async function fetchListing(id: string): Promise<MarketplaceListing> {
  return invoke<MarketplaceListing>("plugin_marketplace_get", { id });
}

// S-PLM-008: SPDX licences we consider safe-by-default. Anything else
// shows a warning ("This plugin is licensed under <X>; review before
// installing"). Strict — we'd rather alert than silently allow exotic
// terms.
const SAFE_LICENCES = new Set([
  "MIT", "Apache-2.0", "BSD-2-Clause", "BSD-3-Clause", "ISC", "MPL-2.0",
  "0BSD", "Unlicense", "CC0-1.0",
]);

export function licenceWarning(license: string | null): string | null {
  if (!license) return "no licence declared — proceed at your own risk";
  if (SAFE_LICENCES.has(license)) return null;
  if (license.toUpperCase().startsWith("GPL")) return "GPL-licensed plugins may impose copy-left obligations";
  return `unfamiliar licence: ${license}`;
}

// S-PLM-009: surface the consent dialog payload. Calling code wires this
// into the existing modal stack — no separate dialog component lives
// here so the look-and-feel matches the rest of the app.
export interface ConsentPayload {
  pluginId: string;
  pluginName: string;
  /** Per-permission human strings, ordered for display. */
  permissionLines: string[];
  /** S-PLM-025: extra warning when network: ["*"] is requested. */
  networkWildcard: boolean;
  /** S-PLM-026: extra warning when fs.outside is requested. */
  fsOutside: boolean;
}

export function buildConsent(manifest: PluginManifest): ConsentPayload {
  const permissionLines = manifest.permissions.map(describePermission);
  const networkWildcard = manifest.permissions.some(
    (p) => typeof p === "object" && "network" in p && p.network.includes("*"),
  );
  const fsOutside = manifest.permissions.includes("fs.outside");
  return {
    pluginId: manifest.id,
    pluginName: manifest.name,
    permissionLines,
    networkWildcard,
    fsOutside,
  };
}

// S-PLM-010 / S-PLM-011 / S-PLM-013: install runs Rust-side and emits
// progress events. The renderer subscribes via the standard event bus.
export interface InstallProgress {
  id: string;
  phase: "download" | "verify" | "extract" | "register" | "activate";
  /** 0..1 within the current phase. */
  fraction: number;
  /** Total bytes pulled — useful for the chip. */
  bytesPulled: number;
  totalBytes: number;
}

export interface InstallOutcome {
  ok: boolean;
  installedVersion?: string;
  error?: { code: string; message: string };
}

export async function installPlugin(id: string, version: string): Promise<InstallOutcome> {
  return invoke<InstallOutcome>("plugin_install", { pluginId: id, version });
}

// S-PLM-016 / S-PLM-017 / S-PLM-018: enable/disable/uninstall. We keep
// "disabled" plugins on disk so re-enabling is instant.
export async function enablePlugin(id: string): Promise<void> {
  await invoke("plugin_enable", { pluginId: id });
}

export async function disablePlugin(id: string): Promise<void> {
  await invoke("plugin_disable", { pluginId: id });
}

export async function uninstallPlugin(id: string): Promise<void> {
  await invoke("plugin_uninstall", { pluginId: id });
}

// S-PLM-019 / S-PLM-020 / S-PLM-021: update flow. The marketplace
// poller queries weekly (configurable) and surfaces a badge on the
// Installed tab. If the new version requests *additional* permissions
// over the installed one, we *always* ask for re-consent — silently
// upgrading would let an attacker who took over a popular plugin
// quietly add `fs.outside`.
export interface UpdateAvailable {
  id: string;
  installedVersion: string;
  latestVersion: string;
  permissionDelta: PluginPermission[]; // empty when no new perms
}

export function permissionDelta(prev: PluginPermission[], next: PluginPermission[]): PluginPermission[] {
  const key = (p: PluginPermission) => (typeof p === "string" ? p : JSON.stringify(p));
  const prevKeys = new Set(prev.map(key));
  return next.filter((p) => !prevKeys.has(key(p)));
}

export async function checkForUpdates(): Promise<UpdateAvailable[]> {
  return invoke<UpdateAvailable[]>("plugin_marketplace_updates");
}

// S-PLM-022: explicit downgrade. We don't expose this in the main UI
// (downgrades are a footgun in dependency graphs), but Settings → Plugins
// → "Install specific version" has a free-form input that calls this.
export async function installVersion(id: string, version: string): Promise<InstallOutcome> {
  return invoke<InstallOutcome>("plugin_install", { pluginId: id, version });
}

// S-PLM-023: registry cache. The Rust side caches search/listing
// responses for 1h with a stale-while-revalidate strategy — when the
// registry is slow we still render *something* and refresh in the
// background. The TS side just declares the desired freshness; the
// cache is stored on disk so it survives restarts.
export const REGISTRY_CACHE_TTL_MS = 60 * 60 * 1000;

// S-PLM-024: unpublished package handling. npm allows authors to
// unpublish for the first 72h. After install, if the registry returns
// 404 for a package we have on disk, we keep running but disable
// auto-update and surface a warning so the user can switch to a fork.
export interface UnpublishedSignal {
  pluginId: string;
  detectedAt: number;
}
