import { invoke } from "@tauri-apps/api/core";
import { open as openDialog } from "@tauri-apps/plugin-dialog";
import { useSingleFile } from "../store/single-file";

interface FsReadResult {
  text: string;
  encoding: string;
  bytes: number;
  truncated: boolean;
}

export function parentDir(path: string): string {
  const sep = path.includes("\\") ? "\\" : "/";
  const idx = path.lastIndexOf(sep);
  if (idx <= 0) return path;
  return path.slice(0, idx);
}

export async function openSingleMdFromDialog(): Promise<string | null> {
  const selected = await openDialog({
    multiple: false,
    title: "Open markdown file",
    filters: [
      { name: "Markdown", extensions: ["md", "markdown", "mdx"] },
      { name: "All files", extensions: ["*"] },
    ],
  });
  if (typeof selected !== "string" || selected.length === 0) {
    return null;
  }
  const result = await invoke<FsReadResult>("fs_read", { path: selected });
  useSingleFile.getState().open(selected, result.text);
  return selected;
}
