// S-SE-001 / S-SE-003: path canonicalisation + workspace-scope check.
//
// Tauri's allow-list lets us declare which directory subtrees are
// readable/writable by the renderer. The TS side mirrors the same logic
// before issuing IPC: we canonicalise the candidate path (resolve `..`,
// strip symlinks via the Rust IPC `fs_canonicalize`) and verify it sits
// inside the active workspace. Anything outside is bounced before the
// IPC fires so the renderer never even *attempts* the cross-boundary
// read — symmetric defence in depth.

import { invoke } from "@tauri-apps/api/core";

export class PathTraversalError extends Error {
  readonly attempt: string;
  readonly workspace: string;
  constructor(attempt: string, workspace: string) {
    super(`path "${attempt}" escapes workspace "${workspace}"`);
    this.attempt = attempt;
    this.workspace = workspace;
    this.name = "PathTraversalError";
  }
}

export async function canonicalize(path: string): Promise<string> {
  return invoke<string>("fs_canonicalize", { path });
}

// Return the canonical path *only if* it sits inside `workspace` after
// resolution. Throws PathTraversalError otherwise. Use this on every
// user-supplied path before opening, watching, or indexing.
export async function inWorkspace(workspace: string, candidate: string): Promise<string> {
  const wsCanon = await canonicalize(workspace);
  const candCanon = await canonicalize(candidate);
  // Use a trailing separator on the workspace prefix so `/foo` doesn't
  // accidentally match `/foobar`.
  const sep = wsCanon.endsWith("/") || wsCanon.endsWith("\\") ? "" : determineSeparator(wsCanon);
  const prefix = wsCanon + sep;
  if (candCanon !== wsCanon && !candCanon.startsWith(prefix)) {
    throw new PathTraversalError(candidate, workspace);
  }
  return candCanon;
}

function determineSeparator(p: string): string {
  return p.includes("\\") ? "\\" : "/";
}

// Lightweight pre-check that doesn't hit IPC — useful for synchronous
// validation at form-input time. It catches obvious attempts like `../`
// in the input but does NOT replace canonicalize+inWorkspace; symlinks
// can still escape.
export function looksTraversal(input: string): boolean {
  const norm = input.replace(/\\/g, "/");
  if (norm.includes("/../")) return true;
  if (norm.startsWith("../") || norm === "..") return true;
  if (norm.endsWith("/..")) return true;
  return false;
}
