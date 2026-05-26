// ADR-0010 (Migration section): `.markspread/layout.json` schemaVersion
// 1 → 2. The on-disk top-level shape gains a `shell` discriminator and a
// `chat` slot. Existing v1 workspaces hydrate as `shell: 'editor'` so
// muscle memory is intact; the wizard path that creates a *new*
// workspace decides between 'chat' (default, ADR D1) and 'editor' based
// on whether the user has any AI credentials.
//
// This module is intentionally pure: the renderer reads/writes the JSON
// blob, calls `migrateLayoutShell` to normalise it, and persists the
// result. The Rust side is unaware of the chat slot — v1 binaries that
// encounter v2 simply ignore the unknown fields (forward compatibility
// promised in the ADR).

import { emitTelemetry } from "../../store/telemetry";

export type LayoutShell = "chat" | "editor";

export interface LayoutV1 {
  schemaVersion: 1;
  editor?: unknown;
  sidebar?: unknown;
  [key: string]: unknown;
}

export interface LayoutV2 {
  schemaVersion: 2;
  shell: LayoutShell;
  editor?: unknown;
  sidebar?: unknown;
  chat: ChatSlot | null;
  [key: string]: unknown;
}

export interface ChatSlot {
  activeSessionId: string | null;
}

export type AnyLayout = LayoutV1 | LayoutV2;

export const LAYOUT_SCHEMA_VERSION = 2 as const;

function isObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

/**
 * Normalise a parsed `.markspread/layout.json` blob into the current v2
 * shape. v1 inputs gain `shell: 'editor'` (legacy default — preserves
 * muscle memory). Unknown shapes pass through untouched at the v2
 * level so the caller can decide whether to discard or repair.
 */
export function migrateLayoutShell(input: unknown): LayoutV2 | null {
  if (!isObject(input)) return null;
  const sv = input.schemaVersion;
  if (sv === 2) {
    // Already v2 — but defensively fill in fields a newer writer may
    // have left out.
    const shell: LayoutShell = input.shell === "chat" ? "chat" : "editor";
    const chat = isObject(input.chat) ? (input.chat as unknown as ChatSlot) : null;
    return {
      ...input,
      schemaVersion: 2,
      shell,
      chat,
    } as LayoutV2;
  }
  if (sv === 1) {
    const next: LayoutV2 = {
      ...input,
      schemaVersion: 2,
      shell: "editor",
      chat: null,
    };
    return next;
  }
  // Unknown version — refuse to guess.
  return null;
}

export interface ShellDefaultDecisionInput {
  /** True when at least one AI credential exists in the keychain. */
  hasCredentials: boolean;
  /** Honour the runtime feature flag (env / settings). */
  chatShellEnabled: boolean;
}

/**
 * Decide the *initial* shell for a freshly-created workspace per the
 * Migration section of ADR-0010. New workspaces prefer chat unless
 * (a) the feature flag is off or (b) the user has no AI credentials.
 * Either reason demotes the default to 'editor' and a telemetry event
 * records what happened so we can spot misroutes.
 */
export function decideInitialShell(input: ShellDefaultDecisionInput): LayoutShell {
  const chosen: LayoutShell = input.chatShellEnabled && input.hasCredentials ? "chat" : "editor";
  emitTelemetry({
    type: "migration.shell_default_applied",
    chosen,
    hadCredentials: input.hasCredentials,
  });
  return chosen;
}
