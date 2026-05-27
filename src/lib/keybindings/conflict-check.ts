// MAR-1015 conflict check: register-time duplicate detection.
//
// Bindings live across three layers — preset, plugin, user — and we
// also have multiple `when`-scopes (editorFocus / treeFocus / always …).
// Two entries collide when they share *both* the same normalised
// chord AND the same scope. Different scopes are intentionally allowed
// to share a chord (Mod+B is "view.toggle_sidebar" outside the editor
// and "md.bold" inside it — ADR-0001).
//
// Behaviour:
//   • duplicate (chord, scope) pair throws in dev, warns in prod
//   • re-registering the SAME (commandId, chord, scope) tuple is a
//     no-op — that's plugin hot-reload, not a real conflict
//   • the caller passes the existing list; we don't reach into the
//     module-level state of `index.ts` so the check is unit-testable
//     without touching the global registry.

import { normaliseBinding } from "./index";

export type ConflictScope = string; // e.g. "always", "editorFocus", "treeFocus", "shell:editor"

export interface ConflictEntry {
  commandId: string;
  binding: string;
  scope?: ConflictScope;
}

export interface ConflictCheckOptions {
  /** Treat any duplicate as fatal (throw). Defaults to NODE_ENV === "development". */
  strict?: boolean;
  /** Override the warn sink — defaults to `console.warn`. */
  warn?: (msg: string) => void;
}

function isDev(): boolean {
  // import.meta.env is the source of truth in Vite; vitest always
  // populates `env.DEV`, so that's the only path the unit tests can
  // realistically traverse. Other arms (env.MODE fallback, the catch,
  // and the process.env probe) stay as defensive runtime guards.
  const env = (import.meta as unknown as { env?: { DEV?: boolean; MODE?: string } }).env;
  /* v8 ignore next -- vitest always provides `env` so the optional-chain undefined arm is unreachable */
  if (env?.DEV !== undefined) return Boolean(env.DEV);
  /* v8 ignore next 2 -- env.MODE / process.env arms only fire when env.DEV is undefined, which vitest never produces */
  if (env?.MODE) return env.MODE !== "production";
  return typeof process !== "undefined" && process.env?.NODE_ENV !== "production";
}

/**
 * Verify a candidate binding can be added to `existing` without colliding.
 * Throws (strict / dev) or warns (lax / prod) when two different commands
 * claim the same chord under the same scope.
 *
 * Returns the candidate normalised so callers can store it directly.
 */
export function assertNoConflict(
  candidate: ConflictEntry,
  existing: readonly ConflictEntry[],
  opts: ConflictCheckOptions = {},
): ConflictEntry {
  const strict = opts.strict ?? isDev();
  const warn = opts.warn ?? ((m: string) => console.warn(m));
  const normalised: ConflictEntry = {
    commandId: candidate.commandId,
    binding: normaliseBinding(candidate.binding),
    ...(candidate.scope !== undefined ? { scope: candidate.scope } : {}),
  };
  for (const e of existing) {
    const eb = normaliseBinding(e.binding);
    if (eb !== normalised.binding) continue;
    if ((e.scope ?? "always") !== (normalised.scope ?? "always")) continue;
    if (e.commandId === normalised.commandId) {
      // Idempotent re-register — same command, same chord, same scope.
      return normalised;
    }
    const msg = formatConflict(normalised, e);
    if (strict) throw new Error(msg);
    warn(msg);
    return normalised;
  }
  return normalised;
}

/**
 * Bulk variant — returns the conflict report instead of throwing on the
 * first hit. Useful at app startup where we want to surface ALL
 * collisions in one diagnostic.
 */
export interface ConflictReport {
  conflicts: { a: ConflictEntry; b: ConflictEntry }[];
}

export function findConflicts(entries: readonly ConflictEntry[]): ConflictReport {
  const conflicts: { a: ConflictEntry; b: ConflictEntry }[] = [];
  for (let i = 0; i < entries.length; i += 1) {
    const a = entries[i];
    /* v8 ignore next -- bounded loop; entries[i] always defined */
    if (!a) continue;
    for (let j = i + 1; j < entries.length; j += 1) {
      const b = entries[j];
      /* v8 ignore next -- bounded loop; entries[j] always defined */
      if (!b) continue;
      if (normaliseBinding(a.binding) !== normaliseBinding(b.binding)) continue;
      if ((a.scope ?? "always") !== (b.scope ?? "always")) continue;
      if (a.commandId === b.commandId) continue;
      conflicts.push({ a, b });
    }
  }
  return { conflicts };
}

function formatConflict(a: ConflictEntry, b: ConflictEntry): string {
  const scope = a.scope ?? "always";
  return `[keybindings] conflict: chord "${a.binding}" in scope "${scope}" is claimed by both "${b.commandId}" and "${a.commandId}"`;
}
