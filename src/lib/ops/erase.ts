// S-OP-001: front-end wrapper for `ops_erase_all`. The host enforces
// the same token, but we double-check here so the user gets an
// instant error before the IPC round-trip.

import { invoke } from "@tauri-apps/api/core";

export const ERASE_CONFIRMATION_TOKEN = "MARKSPREAD ERASE";

export type EraseReport = {
  dataDirRemoved: boolean;
  dataDirPath: string;
  keychainItemsRemoved: string[];
  keychainItemsMissing: string[];
};

export class EraseConfirmationError extends Error {
  constructor() {
    super(`Type "${ERASE_CONFIRMATION_TOKEN}" exactly to confirm.`);
    this.name = "EraseConfirmationError";
  }
}

export async function eraseAllData(confirmation: string): Promise<EraseReport> {
  if (confirmation !== ERASE_CONFIRMATION_TOKEN) {
    throw new EraseConfirmationError();
  }
  return invoke<EraseReport>("ops_erase_all", { confirmation });
}

// S-OP-002: per-workspace index reset. The host re-triggers a
// rebuild and emits `ops://index-erased` when done.
export type EraseIndexReport = {
  workspace: string;
  hadInMemoryIndex: boolean;
  onDiskIndexRemoved: boolean;
  rebuildTriggered: boolean;
};

export async function eraseWorkspaceIndex(workspace: string): Promise<EraseIndexReport> {
  return invoke<EraseIndexReport>("ops_erase_index", { workspace });
}

// S-OP-003: drops only the AI provider keys from the keychain. The
// rest of the configuration is left alone.
export async function eraseAiKeys(): Promise<EraseReport> {
  return invoke<EraseReport>("ops_erase_ai_keys");
}

// S-OP-007: cache directories only. Returns how much was freed.
export type CleanCacheReport = {
  bytesFreed: number;
  pathsRemoved: string[];
};

export async function cleanCache(): Promise<CleanCacheReport> {
  return invoke<CleanCacheReport>("ops_clean_cache");
}
