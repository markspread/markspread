// `.markspread/layout.json` schemaVersion 1 → 2.
//
// ADR-0010 originally added a `shell` discriminator + `chat` slot to the
// v2 shape (chat/editor dual shell). ADR-0019 §Decision.1 unified the
// shells into a single Workspace surface and dropped `preferredShell`,
// so the on-disk `shell` / `chat` keys no longer carry meaning. The
// schemaVersion bump itself is retained (the Rust ladder constant is 2),
// but the migration now only normalises the version and strips the dead
// `shell` / `chat` keys from any pre-existing v2 blob written by an older
// build. A v1 binary that encounters v2 simply ignores unknown fields.
//
// This module is intentionally pure: the renderer reads/writes the JSON
// blob and calls `migrateLayoutShell` to normalise it.

export interface LayoutV1 {
  schemaVersion: 1;
  editor?: unknown;
  sidebar?: unknown;
  [key: string]: unknown;
}

export interface LayoutV2 {
  schemaVersion: 2;
  editor?: unknown;
  sidebar?: unknown;
  [key: string]: unknown;
}

export type AnyLayout = LayoutV1 | LayoutV2;

export const LAYOUT_SCHEMA_VERSION = 2 as const;

function isObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

/**
 * Normalise a parsed `.markspread/layout.json` blob into the current v2
 * shape. v1 inputs are bumped to v2. Any legacy `shell` / `chat` keys
 * (written by a pre-ADR-0019 build) are stripped, since the dual shell
 * no longer exists. Unknown schema versions return `null` so the caller
 * can decide whether to discard or repair.
 */
export function migrateLayoutShell(input: unknown): LayoutV2 | null {
  if (!isObject(input)) return null;
  const sv = input.schemaVersion;
  if (sv === 2 || sv === 1) {
    const { shell: _shell, chat: _chat, ...rest } = input;
    return {
      ...rest,
      schemaVersion: 2,
    } as LayoutV2;
  }
  // Unknown version — refuse to guess.
  return null;
}
