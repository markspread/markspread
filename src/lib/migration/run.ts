// T-U34-001 boot wiring: ask the Rust side to apply any pending schema
// migrations before React mounts. The handler is expected to be
// idempotent — passing the current schema version on every launch is
// the design so the frontend never holds version state.

import { invoke } from "@tauri-apps/api/core";

// Bump this in lockstep with the Rust migration ladder. The renderer
// owns the constant because every other store on disk reads through
// adapters that depend on the same value.
export const CURRENT_SCHEMA_VERSION = 1;

export async function runMigration(): Promise<void> {
  try {
    await invoke("migration_run", { schemaVersion: CURRENT_SCHEMA_VERSION });
  } catch (e) {
    // Handler may not be wired yet (S-U33-006). Boot proceeds — the
    // Rust side will gate any feature that actually requires a
    // migrated schema.
    console.warn("[migration] run failed", e);
  }
}
