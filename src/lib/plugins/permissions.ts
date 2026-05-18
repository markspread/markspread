// S-PL-011..016: host API permission gates.
//
// Plugins call host APIs through the bridge. Every call is gated by a
// permission check — the manifest declares what the plugin is allowed to
// do, and the host enforces it on each call. This is paranoia-by-design:
// if a plugin's bundle is compromised, the bridge still won't let it do
// anything outside the manifest-declared envelope.
//
// Some permissions are sticky (granted at install time and remembered);
// others are interactive (every call shows a dialog). The category
// determines whether we ever auto-allow.

import { invoke } from "@tauri-apps/api/core";
import type { PluginManifest, PluginPermission } from "./manifest";

export type HostApi =
  | { kind: "fs.workspace.read"; path: string }
  | { kind: "fs.workspace.write"; path: string; bytes: number }
  | { kind: "fs.outside.read"; path: string }
  | { kind: "fs.outside.write"; path: string; bytes: number }
  | { kind: "network"; url: string }
  | { kind: "keychain.resolve"; alias: string }
  | { kind: "shell"; command: string };

export interface PermissionDecision {
  allow: boolean;
  reason: string;
}

// Pre-flight check against the manifest. Returns:
//   - allow:true  — manifest grants this; proceed
//   - allow:false — manifest forbids; reject without prompting
//   - "prompt"    — manifest grants in principle but each call needs
//                   user confirmation (S-PL-013 outside-workspace fs)
export type ManifestCheck = "allow" | "deny" | "prompt";

export function checkAgainstManifest(api: HostApi, manifest: PluginManifest): ManifestCheck {
  const perms = manifest.permissions;

  switch (api.kind) {
    case "fs.workspace.read":
      return perms.includes("fs.workspace-read") || perms.includes("fs.workspace-write")
        ? "allow"
        : "deny";

    case "fs.workspace.write":
      return perms.includes("fs.workspace-write") ? "allow" : "deny";

    case "fs.outside.read":
    case "fs.outside.write":
      // S-PL-013: outside-workspace fs always shows a per-call dialog,
      // even when the manifest declares the permission. This is the
      // single category where the manifest grants *capability*, not
      // *consent* — the user gets the final say each time.
      return perms.includes("fs.outside") ? "prompt" : "deny";

    case "network": {
      // S-PL-014: hostname allow-list. Wildcard `*` matches any subdomain
      // of the parent. The manifest stores hostnames; we check the URL
      // host against each entry.
      const networkPerm = perms.find(
        (p): p is { network: string[] } => typeof p === "object" && "network" in p,
      );
      if (!networkPerm) return "deny";
      let host: string;
      try {
        host = new URL(api.url).host.toLowerCase();
      } catch {
        return "deny";
      }
      const allow = networkPerm.network.some((entry) => matchHost(host, entry.toLowerCase()));
      return allow ? "allow" : "deny";
    }

    case "keychain.resolve": {
      // S-PL-015: alias allow-list. Plugins never see key material, only
      // resolve-by-alias to obtain a session-scoped token the host
      // injects on outgoing requests for them.
      const keychainPerm = perms.find(
        (p): p is { keychain: string[] } => typeof p === "object" && "keychain" in p,
      );
      if (!keychainPerm) return "deny";
      return keychainPerm.keychain.includes(api.alias) ? "allow" : "deny";
    }

    case "shell":
      // S-PL-016: shell is hard-denied in v1 regardless of manifest. The
      // permission name parses, but the gate refuses every call so a
      // compromised plugin with a `"shell"` declaration cannot act on it.
      return "deny";
  }
}

// Hostname matcher: `*.example.com` matches `api.example.com` but not
// `evil.com.attacker.example.com`. Bare hostnames must match exactly.
function matchHostSingle(host: string, pattern: string): boolean {
  if (pattern.startsWith("*.")) {
    const suffix = pattern.slice(1); // ".example.com"
    return host.endsWith(suffix) && host.length > suffix.length;
  }
  return host === pattern;
}

/**
 * Public host matcher used by the manifest check and the threat-model
 * regression tests. Accepts a single pattern (legacy) or a list — any
 * match in the list returns true.
 */
export function matchHost(host: string, patterns: string | string[]): boolean {
  const list = Array.isArray(patterns) ? patterns : [patterns];
  return list.some((p) => matchHostSingle(host, p));
}

// A short JSON summary of the call's distinguishing inputs, stored in the
// audit log so the Privacy panel can show "wrote 4 KB to <path>" etc.
function summariseApi(api: HostApi): string {
  return JSON.stringify(api);
}

// Record one permission decision in the Rust-backed audit log. The Rust
// `plugin_permission_audit` handler expects a single `entry` object
// (S-SE-019); `decision`/`reason` ride inside it.
function recordDecision(
  pluginId: string,
  api: HostApi,
  decision: AuditDecision,
  reason: string,
): void {
  void invoke("plugin_permission_audit", {
    entry: {
      ts: Date.now(),
      pluginId,
      apiKind: api.kind,
      apiSummary: summariseApi(api),
      decision,
      reason,
    },
  }).catch(() => {});
}

type AuditDecision = "allow" | "deny" | "allow-once" | "deny-once";

// The interactive consent resolver. The UI layer (PluginPermissionDialog)
// supplies this so `gateHostApi` stays free of React. When omitted, a
// prompt-required call fails closed — "when in doubt, deny".
export type ConsentResolver = (pluginId: string, api: HostApi) => Promise<boolean>;

// Higher-level check: combine manifest + interactive prompt + audit log.
// All host-API calls go through this single funnel — the bridge has no
// direct path to the underlying capability.
export async function gateHostApi(
  pluginId: string,
  manifest: PluginManifest,
  api: HostApi,
  requestConsent?: ConsentResolver,
): Promise<PermissionDecision> {
  const verdict = checkAgainstManifest(api, manifest);
  if (verdict === "deny") {
    recordDecision(pluginId, api, "deny", `manifest does not grant ${api.kind}`);
    return { allow: false, reason: `manifest does not grant ${api.kind}` };
  }
  if (verdict === "prompt") {
    const ok = requestConsent ? await requestConsent(pluginId, api) : false;
    // Persist the grant so the Privacy panel reflects it (S-PLM-009).
    void invoke("plugin_permission_prompt", { pluginId, granted: ok }).catch(() => {});
    recordDecision(
      pluginId,
      api,
      ok ? "allow-once" : "deny-once",
      ok ? "user approved this call" : "user declined this call",
    );
    return { allow: ok, reason: ok ? "user approved this call" : "user declined this call" };
  }
  recordDecision(pluginId, api, "allow", "granted by manifest");
  return { allow: true, reason: "granted by manifest" };
}

// Render a manifest permission as user-readable text for the install
// confirmation dialog. The settings UI also reuses this in the "what can
// this plugin do" section.
export function describePermission(p: PluginPermission): string {
  if (typeof p === "string") {
    switch (p) {
      case "fs.workspace-read":  return "Read files in the open workspace";
      case "fs.workspace-write": return "Read and write files in the open workspace";
      case "fs.outside":         return "Ask each time to read/write files outside the workspace";
      case "shell":              return "(blocked in v1) Run shell commands";
    }
  }
  if ("network" in p) return `Make network requests to: ${p.network.join(", ")}`;
  if ("keychain" in p) return `Use AI key alias: ${p.keychain.join(", ")}`;
  return "Unknown permission";
}
