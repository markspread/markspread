// S-KB-012: plugin keybinding contribution surface. The plugin runtime
// calls these on activation / deactivation. Plugin manifests carry
// `contributes.keybindings: [{ command, key }]`; we trust the host to
// have validated the manifest already (S-PL-001 path), and just take
// the (commandId, binding) pairs.
//
// Acceptance:
//   • plugin's recommended bindings are user-overridable — already
//     true by virtue of `listActiveBindings` letting userOverrides
//     win over plugin entries.
//   • on plugin uninstall, plugin mappings auto-cleaned — handled by
//     applyPluginManifestKeybindings(pluginId, undefined). User
//     overrides for plugin-owned commands stay (acceptance bullet 2).

import {
  registerPluginKeybindings,
  unregisterPluginKeybindings,
} from ".";

type ManifestKeybinding = {
  command: string;
  key: string;
};

/**
 * Apply (or clear) the keybindings declared in a plugin manifest.
 * Pass `null`/`undefined` for `entries` to unregister.
 */
export function applyPluginManifestKeybindings(
  pluginId: string,
  entries: readonly ManifestKeybinding[] | null | undefined,
): void {
  if (!entries || entries.length === 0) {
    unregisterPluginKeybindings(pluginId);
    return;
  }
  registerPluginKeybindings(
    pluginId,
    entries.map((e) => ({ commandId: e.command, binding: e.key })),
  );
}

/**
 * Read the keybinding contributions out of a parsed manifest. Returns
 * an empty array if the contribution point is missing or malformed —
 * the host validator (S-PL-001..004) is responsible for surfacing
 * structural errors, this helper is just an extractor.
 */
export function extractManifestKeybindings(
  contributes: Record<string, unknown> | undefined,
): ManifestKeybinding[] {
  if (!contributes) return [];
  const raw = contributes.keybindings;
  if (!Array.isArray(raw)) return [];
  const out: ManifestKeybinding[] = [];
  for (const item of raw) {
    if (!item || typeof item !== "object") continue;
    const rec = item as Record<string, unknown>;
    if (typeof rec.command !== "string") continue;
    if (typeof rec.key !== "string") continue;
    out.push({ command: rec.command, key: rec.key });
  }
  return out;
}
