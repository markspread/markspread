// S-OP-008: safe-mode toggle. The flag is persisted in
// settings.json and consumed at boot by the plugin loader. The
// front-end exposes it as a Settings → Advanced switch.

import { invoke } from "@tauri-apps/api/core";

export async function getSafeMode(): Promise<boolean> {
  return invoke<boolean>("ops_safe_mode_get");
}

export async function setSafeMode(enabled: boolean): Promise<void> {
  await invoke("ops_safe_mode_set", { enabled });
}
