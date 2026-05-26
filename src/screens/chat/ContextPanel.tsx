// ADR-0010 D2 (right column) + D4: ContextPanel — compact file tree,
// active preview, pinned snippets, token gauge. For U1 the FileTree
// is a stub list — wiring the full `<FileTree workspace>` component
// here means pulling the workspace IPC surface into the chat shell;
// that lives in U2's "incremental cleanup" sweep referenced by D4.

import { useMemo } from "react";
import { buildContextPack } from "../../lib/ai/context-pack";

export interface ContextPanelProps {
  workspaceId: string;
  activeFilePath: string | null;
  onPickFile: (path: string | null) => void;
}

const DEFAULT_TOKEN_BUDGET = 16_000;

export function ContextPanel({ workspaceId, activeFilePath, onPickFile }: ContextPanelProps) {
  // Build a pack from the current state so the token gauge reflects
  // what the next message would carry. The Active file content is not
  // wired here — U2 will read it from useDocCache.
  const pack = useMemo(
    () =>
      buildContextPack({
        workspaceId,
        activeFilePath,
        activeFileContent: null,
        selection: null,
        recentlyEdited: [],
        pinnedSnippets: [],
        tokenBudget: DEFAULT_TOKEN_BUDGET,
      }),
    [workspaceId, activeFilePath],
  );

  const pct = Math.min(100, Math.round((pack.tokensUsed / pack.tokensBudget) * 100));

  return (
    <div className="flex h-full flex-col">
      <section className="border-[var(--color-border)] border-b p-2">
        <div className="mb-1 text-[var(--color-muted)] text-xs uppercase tracking-wide">
          Files (compact)
        </div>
        <div data-testid="chat-file-tree" className="text-[var(--color-muted)] text-xs italic">
          {workspaceId ? "File tree wired in U2" : "(no workspace)"}
        </div>
        {activeFilePath && (
          <button
            type="button"
            data-testid="chat-clear-active-file"
            onClick={() => onPickFile(null)}
            className="mt-1 text-[var(--color-accent)] text-xs underline"
          >
            Clear active file
          </button>
        )}
      </section>
      <section className="flex-1 overflow-auto border-[var(--color-border)] border-b p-2">
        <div className="mb-1 text-[var(--color-muted)] text-xs uppercase tracking-wide">
          Active preview
        </div>
        <div data-testid="chat-active-preview" className="text-sm">
          {activeFilePath ?? (
            <span className="text-[var(--color-muted)] italic">No file selected</span>
          )}
        </div>
      </section>
      <section className="border-[var(--color-border)] border-b p-2">
        <div className="mb-1 text-[var(--color-muted)] text-xs uppercase tracking-wide">
          Pinned snippets
        </div>
        <div data-testid="chat-pinned" className="text-[var(--color-muted)] text-xs italic">
          No pins yet
        </div>
      </section>
      <section className="p-2" data-testid="chat-token-gauge">
        <div className="mb-1 text-[var(--color-muted)] text-xs uppercase tracking-wide">
          Context tokens
        </div>
        <div
          className="h-2 w-full overflow-hidden rounded bg-[var(--color-border)]"
          role="progressbar"
          tabIndex={0}
          aria-valuemin={0}
          aria-valuemax={pack.tokensBudget}
          aria-valuenow={pack.tokensUsed}
          aria-label="Context token usage"
        >
          <div
            className="h-full bg-[var(--color-accent)]"
            style={{ width: `${pct}%` }}
            data-testid="chat-token-gauge-fill"
          />
        </div>
        <div className="mt-1 text-[var(--color-muted)] text-xs">
          {pack.tokensUsed} / {pack.tokensBudget} ({pct}%)
        </div>
      </section>
    </div>
  );
}
