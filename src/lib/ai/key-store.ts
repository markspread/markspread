// S-AIK-005..017, S-AIK-020: AI key registry — alias-keyed entries backed by
// the OS keychain via Tauri IPC.
//
// The renderer never holds the raw key in long-lived state. The Add Provider
// form keeps it just long enough to call `ai_key_save`, which hands it to
// the Rust side; the Rust side stores it in the keychain and zeroises its
// in-process copy. From that point on the renderer only ever sees aliases
// and metadata (provider, model, masked tail). Key material returns to
// memory only when the runner calls `ai_key_resolve` immediately before a
// provider request, and is dropped as soon as the request returns.

import { invoke } from "@tauri-apps/api/core";
import { create } from "zustand";
import type { ProviderId } from "./providers";

export interface AiKeyEntry {
  alias: string;
  provider: ProviderId;
  model: string;
  /** Optional override — required for `azure-openai`/`openai-compatible`/`ollama`. */
  baseUrl: string | null;
  /** Display-only mask, e.g. `sk-…••••XYZ`. The full key never reaches the renderer. */
  maskedKey: string;
  createdAt: number;
}

export interface KeyStoreState {
  entries: AiKeyEntry[];
  /** S-AIK-012: which alias is the active default. */
  defaultAlias: string | null;
  load(): Promise<void>;
  /** S-AIK-009 / S-AIK-010 / S-AIK-015: insert-or-overwrite. */
  save(input: SaveKeyInput): Promise<AiKeyEntry>;
  /** S-AIK-014: remove from keychain + registry. */
  remove(alias: string): Promise<void>;
  /** S-AIK-012 / S-AIK-013: set / switch default alias. */
  setDefault(alias: string): Promise<void>;
}

export interface SaveKeyInput {
  alias: string;
  provider: ProviderId;
  model: string;
  baseUrl: string | null;
  /** Plaintext key — handed straight to the Rust side and not persisted in JS state. */
  key: string;
}

export const useKeyStore = create<KeyStoreState>((set) => ({
  entries: [],
  defaultAlias: null,
  async load() {
    const result = await invoke<{ entries: AiKeyEntry[]; defaultAlias: string | null }>(
      "ai_key_list",
    );
    set({ entries: result.entries, defaultAlias: result.defaultAlias });
  },
  async save(input) {
    // S-AIK-009: Rust persists to keychain, returns the entry with the
    // masked key for display. The plaintext `key` field exists in this
    // function's stack frame only.
    const entry = await invoke<AiKeyEntry>("ai_key_save", {
      alias: input.alias,
      provider: input.provider,
      model: input.model,
      baseUrl: input.baseUrl,
      key: input.key,
    });
    set((s) => {
      const without = s.entries.filter((e) => e.alias !== entry.alias);
      const next = [...without, entry].sort((a, b) => a.alias.localeCompare(b.alias));
      // S-AIK-001: first-key-wins for default. After that, only an explicit
      // call to setDefault changes it.
      const defaultAlias = s.defaultAlias ?? entry.alias;
      return { entries: next, defaultAlias };
    });
    if (useKeyStore.getState().defaultAlias === entry.alias) {
      await invoke("ai_key_set_default", { alias: entry.alias }).catch(() => {});
    }
    return entry;
  },
  async remove(alias) {
    await invoke("ai_key_remove", { alias });
    set((s) => {
      const entries = s.entries.filter((e) => e.alias !== alias);
      const defaultAlias = s.defaultAlias === alias ? (entries[0]?.alias ?? null) : s.defaultAlias;
      return { entries, defaultAlias };
    });
  },
  async setDefault(alias) {
    await invoke("ai_key_set_default", { alias });
    set({ defaultAlias: alias });
  },
}));

// S-AIK-005: in-form masking. As the user types we keep the latest character
// visible for ~600ms (long enough to spot a typo) then mask it. This trade-off
// matches what password managers do — silent full-mask makes typing errors
// invisible, full-plaintext defeats the purpose of being in a private field.
export function maskInFlight(key: string, lastTypedAt: number, now: number): string {
  if (key.length === 0) return "";
  if (now - lastTypedAt < 600) {
    return `${"•".repeat(Math.max(0, key.length - 1))}${key.slice(-1)}`;
  }
  return "•".repeat(key.length);
}
