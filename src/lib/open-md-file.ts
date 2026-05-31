import { invoke } from "@tauri-apps/api/core";
import { open as openDialog } from "@tauri-apps/plugin-dialog";
import { useSingleFile } from "../store/single-file";

// FIX: Rust `fs_read_file(workspace, path)` 는 FsReadResult 객체 반환,
//      이전 `fs_read(workspace, path) -> String` 도 workspace 필수.
//      이전 코드는 workspace 누락 + 잘못된 result shape 사용 → 단일 파일 open 실패.
interface FsReadFileResult {
  content: string;
  encoding: string;
  mtime?: number | null;
  sha256?: string | null;
  large?: boolean;
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
  // 단일 파일 모드 = 파일의 부모 디렉토리를 workspace 로 사용 (ensure_within 통과).
  const workspace = parentDir(selected);
  const result = await invoke<FsReadFileResult>("fs_read_file", {
    workspace,
    path: selected,
  });
  useSingleFile.getState().open(selected, result.content);
  return selected;
}
