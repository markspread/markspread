// S-AIK-016 / S-AIK-017: keychain availability + permission detection.
//
// Linux is the painful platform here — the Secret Service might not be
// running (headless servers, minimal WM setups), and even when it is,
// the user can deny the access prompt the first time we try to read.
// macOS and Windows fail more rarely but the same code paths apply.
//
// We expose a single `probeKeychain()` call that the Settings → AI page
// runs once on mount; the result drives whether we show:
//   - normal Add Provider flow (`available`)
//   - "Unlock your keychain to continue" hint (`locked`)
//   - "Keychain access denied — keys will live in this session only" (`denied`)
//   - "No system keychain detected — install gnome-keyring or kwallet" (`missing`)
//
// The fallback path keeps keys in memory only, so they vanish on restart.
// We never silently write keys to a plaintext file — that would be a worse
// security posture than asking the user to fix their keychain.

import { invoke } from "@tauri-apps/api/core";

export type KeychainStatus =
  | { kind: "available" }
  | { kind: "locked"; hint: string }
  | { kind: "denied"; hint: string }
  | { kind: "missing"; hint: string };

export async function probeKeychain(): Promise<KeychainStatus> {
  try {
    const raw = await invoke<{ status: string; hint?: string }>("ai_keychain_probe");
    switch (raw.status) {
      case "available": return { kind: "available" };
      case "locked":    return { kind: "locked", hint: raw.hint ?? "" };
      case "denied":    return { kind: "denied", hint: raw.hint ?? "" };
      case "missing":   return { kind: "missing", hint: raw.hint ?? "" };
      default: return { kind: "missing", hint: raw.hint ?? "unknown keychain status" };
    }
  } catch (e) {
    return { kind: "missing", hint: (e as Error).message };
  }
}

// User-facing banner copy keys (i18n). Returning the i18n key + a single
// string interpolation slot keeps the call sites uncluttered.
export function statusBanner(s: KeychainStatus): { i18nKey: string; values?: Record<string, string> } | null {
  switch (s.kind) {
    case "available": return null;
    case "locked":    return { i18nKey: "ai.keychain.locked" };
    case "denied":    return { i18nKey: "ai.keychain.denied", values: { hint: s.hint } };
    case "missing":   return { i18nKey: "ai.keychain.missing", values: { hint: s.hint } };
  }
}
