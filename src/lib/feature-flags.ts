// ADR-0010 Migration: feature flags read from a small env-bag so
// builds can pin the chat shell off without a settings round-trip.
// The default is *on* — flipping to off is the safety hatch.

/**
 * `MS_SHELL_CHAT_ENABLED` — when explicitly "0"/"false"/"off"/"no",
 * App routing collapses to the editor branch regardless of the
 * workspace's `preferredShell`. The stored value is preserved so
 * re-enabling the flag restores the user's choice.
 *
 * The env bag is read lazily from `globalThis` so tests can flip
 * values without importing this module twice.
 */
function readEnvFlag(name: string): unknown {
  const g = globalThis as unknown as {
    __MS_ENV?: Record<string, unknown>;
    process?: { env?: Record<string, unknown> };
  };
  if (g.__MS_ENV && name in g.__MS_ENV) return g.__MS_ENV[name];
  if (g.process?.env && name in g.process.env) return g.process.env[name];
  return undefined;
}

export function isChatShellEnabled(envBag?: Record<string, unknown>): boolean {
  const raw = envBag?.MS_SHELL_CHAT_ENABLED ?? readEnvFlag("MS_SHELL_CHAT_ENABLED");
  if (raw === undefined || raw === null) return true;
  const s = String(raw).toLowerCase();
  if (s === "0" || s === "false" || s === "off" || s === "no") return false;
  return true;
}
