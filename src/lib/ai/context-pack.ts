// ADR-0010 D4: single entry point that turns the ChatShell's
// ContextPanel state into a list of system blocks ready to attach to a
// chat message. Priority order — `selection > activeFile > recentChanges
// > pinned > workspaceMeta`. When the rough char-based token estimate
// blows past `tokenBudget`, blocks are dropped from the LOW end and the
// dropped kinds are reported via `trimmedKinds`.
//
// The runtime callers are the ChatShell input box (U2 once LLM is
// wired) and `AiActionPalette` (incremental cleanup per ADR D4).

import { emitTelemetry } from "../../store/telemetry";

export type SystemBlockKind =
  | "selection"
  | "activeFile"
  | "recentChanges"
  | "pinned"
  | "workspaceMeta";

export interface SystemBlock {
  kind: SystemBlockKind;
  /** Compact label for UI chips ("Selection", "notes/a.md"). */
  label: string;
  /** Plain text that becomes the system block in the request body. */
  text: string;
  /** Rough token cost computed at pack time so the gauge can sum quickly. */
  tokens: number;
}

export interface RecentlyEditedFile {
  path: string;
  mtime: number;
  /** Optional unified diff. When omitted the path alone is included. */
  diff?: string;
}

export interface BuildContextPackOptions {
  workspaceId: string;
  workspaceName?: string;
  workspaceFileCount?: number;
  activeFilePath?: string | null;
  activeFileContent?: string | null;
  selection?: string | null;
  recentWindowMs?: number;
  recentlyEdited?: RecentlyEditedFile[];
  pinnedSnippets?: { label: string; text: string }[];
  tokenBudget: number;
}

export interface ContextPack {
  blocks: SystemBlock[];
  tokensUsed: number;
  tokensBudget: number;
  /** Kinds that were trimmed away because the budget was exceeded. */
  trimmedKinds: SystemBlockKind[];
}

/**
 * Rough token estimate. We use the well-known chars/4 heuristic so the
 * gauge updates without a tokenizer dependency. The function is exposed
 * so future callers can swap a model-specific tokenizer in one place.
 */
export function estimateTokens(s: string): number {
  if (!s) return 0;
  return Math.ceil(s.length / 4);
}

/**
 * Build the ordered system-block list. Priority — highest first —
 * selection, activeFile, recentChanges, pinned, workspaceMeta. The
 * trimming pass walks LOW-to-HIGH and drops blocks until the budget
 * fits.
 */
export function buildContextPack(opts: BuildContextPackOptions): ContextPack {
  const candidates: SystemBlock[] = [];

  if (opts.selection && opts.selection.trim().length > 0) {
    const text = opts.selection;
    candidates.push({
      kind: "selection",
      label: "Selection",
      text,
      tokens: estimateTokens(text),
    });
  }

  if (
    opts.activeFilePath &&
    typeof opts.activeFileContent === "string" &&
    opts.activeFileContent.length > 0
  ) {
    const text = `# ${opts.activeFilePath}\n${opts.activeFileContent}`;
    candidates.push({
      kind: "activeFile",
      label: opts.activeFilePath,
      text,
      tokens: estimateTokens(text),
    });
  }

  const recents = opts.recentlyEdited ?? [];
  if (recents.length > 0) {
    const body = recents
      .map((r) => (r.diff ? `## ${r.path}\n${r.diff}` : `- ${r.path}`))
      .join("\n");
    const text = `Recent changes\n${body}`;
    candidates.push({
      kind: "recentChanges",
      label: `${recents.length} recent file(s)`,
      text,
      tokens: estimateTokens(text),
    });
  }

  const pinned = opts.pinnedSnippets ?? [];
  if (pinned.length > 0) {
    const text = pinned.map((p) => `[${p.label}]\n${p.text}`).join("\n\n");
    candidates.push({
      kind: "pinned",
      label: `${pinned.length} pinned`,
      text,
      tokens: estimateTokens(text),
    });
  }

  // Workspace meta is always small and always last in priority.
  {
    const lines = [`workspaceId=${opts.workspaceId}`];
    if (opts.workspaceName) lines.push(`workspaceName=${opts.workspaceName}`);
    if (typeof opts.workspaceFileCount === "number") {
      lines.push(`fileCount=${opts.workspaceFileCount}`);
    }
    const text = lines.join("\n");
    candidates.push({
      kind: "workspaceMeta",
      label: opts.workspaceName ?? opts.workspaceId,
      text,
      tokens: estimateTokens(text),
    });
  }

  // Trim from the LOW priority end (= end of array).
  const trimmedKinds: SystemBlockKind[] = [];
  let total = candidates.reduce((acc, b) => acc + b.tokens, 0);
  const kept = candidates.slice();
  while (total > opts.tokenBudget && kept.length > 0) {
    const dropped = kept.pop();
    /* v8 ignore next 2 -- loop guard ensures kept.length > 0 above */
    if (!dropped) break;
    trimmedKinds.push(dropped.kind);
    total -= dropped.tokens;
  }

  if (trimmedKinds.length > 0) {
    emitTelemetry({ type: "chat.context_trimmed", trimmedKinds, reason: "budget" });
  }

  return {
    blocks: kept,
    tokensUsed: total,
    tokensBudget: opts.tokenBudget,
    trimmedKinds,
  };
}

/**
 * Filter the doc cache snapshot down to files edited within the
 * `windowMs` window. Decoupled from the concrete doc-cache shape so
 * tests can drive it with plain objects and so future replacements
 * (e.g. a Rust-side mtime index) can plug in without touching callers.
 */
export function getRecentlyEditedFiles(
  files: { path: string; mtime: number }[],
  windowMs: number,
  now: number = Date.now(),
): RecentlyEditedFile[] {
  const cutoff = now - windowMs;
  return files
    .filter((f) => f.mtime >= cutoff)
    .sort((a, b) => b.mtime - a.mtime)
    .map((f) => ({ path: f.path, mtime: f.mtime }));
}

/**
 * Emit a `chat.message_sent` event after a pack has been attached to a
 * send. Exposed as a thin wrapper so the ChatShell input box (U2) can
 * call it without re-implementing the field shape.
 */
export function reportMessageSent(opts: {
  workspaceId: string;
  pack: ContextPack;
}): void {
  emitTelemetry({
    type: "chat.message_sent",
    workspaceId: opts.workspaceId,
    contextBlocks: opts.pack.blocks.map((b) => b.kind),
    tokensUsed: opts.pack.tokensUsed,
    tokensBudget: opts.pack.tokensBudget,
  });
}
