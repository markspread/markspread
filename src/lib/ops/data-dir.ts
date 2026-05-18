// S-OP-006: settings → advanced → "open data folder". The host
// returns the resolved path; the front-end calls os_reveal_path to
// open the OS file manager. If the dir doesn't exist yet, we create
// the parent and show the user *where* the folder will appear once
// they save anything, instead of silently failing.

import { invoke } from "@tauri-apps/api/core";
import { mkdir } from "@tauri-apps/plugin-fs";

export type DataDirInfo = {
  path: string;
  exists: boolean;
};

export async function getDataDirInfo(): Promise<DataDirInfo> {
  return invoke<DataDirInfo>("ops_data_dir_info");
}

export async function revealDataDir(): Promise<DataDirInfo> {
  const info = await getDataDirInfo();
  if (!info.exists) {
    try {
      await mkdir(info.path, { recursive: true });
    } catch {
      // If we cannot create it (e.g. parent is read-only), let the
      // reveal call surface a real OS error to the caller.
    }
  }
  await invoke("os_reveal_path", { path: info.path });
  return info;
}
