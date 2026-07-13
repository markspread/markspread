// MAR-1011: tool-call diff approval dialog.
//
// Renders the current `DiffProposal` (top of the queue) as a coloured
// inline diff and exposes three actions: Accept, Reject, and "Approve
// all in this session". The Approve-all checkbox is a separate state
// flip rather than a button so the user can pre-arm it before deciding.

import { useMemo, useState } from "react";
import { buildLineDiff } from "../lib/agents/diff";
import { type DiffProposal, useToolApprovalQueue } from "../store/tool-approval-queue";

export interface ToolDiffDialogProps {
  proposal: DiffProposal;
  /** Called after the underlying decide() resolves — UI can dismiss. */
  onDone?: () => void;
}

export function ToolDiffDialog({ proposal, onDone }: ToolDiffDialogProps) {
  const decide = useToolApprovalQueue((s) => s.decide);
  const setApproveAll = useToolApprovalQueue((s) => s.setApproveAll);
  const approveAll = useToolApprovalQueue(
    (s) => s.approveAllBySession[proposal.sessionId] ?? false,
  );
  const [busy, setBusy] = useState(false);

  const lines = useMemo(
    () => buildLineDiff(proposal.before, proposal.after),
    [proposal.before, proposal.after],
  );

  const runDecision = async (kind: "accept" | "reject" | "accept_all") => {
    setBusy(true);
    try {
      await decide(proposal.id, kind);
      onDone?.();
    } finally {
      setBusy(false);
    }
  };

  return (
    <section
      data-testid="tool-diff-dialog"
      aria-label="Tool diff approval"
      className="rounded border border-[var(--color-border)] bg-[var(--color-surface)] p-3 text-sm"
    >
      <header className="mb-2 flex items-baseline justify-between">
        <div>
          <span className="font-medium" data-testid="tool-diff-tool">
            {proposal.tool}
          </span>
          <span className="ml-2 text-[var(--color-muted)] text-xs" data-testid="tool-diff-path">
            {proposal.filePath}
          </span>
        </div>
        <label className="flex items-center gap-1 text-xs">
          <input
            type="checkbox"
            data-testid="tool-diff-approve-all"
            checked={approveAll}
            onChange={(e) => setApproveAll(proposal.sessionId, e.target.checked)}
          />
          Approve all in this session
        </label>
      </header>
      {proposal.summary ? (
        <p data-testid="tool-diff-summary" className="mb-2 text-[var(--color-muted)] text-xs">
          {proposal.summary}
        </p>
      ) : null}
      {/* Rust 가 summary 만 전달하는 permission request (diff payload 없음)
          는 빈 diff 박스 대신 summary 카드로만 보인다. */}
      {lines.length > 0 && (
        <pre
          data-testid="tool-diff-pre"
          className="max-h-64 overflow-auto whitespace-pre-wrap rounded bg-[var(--color-surface-subtle)] p-2 font-mono text-xs"
        >
          {lines.map((l, i) => {
            const color =
              l.kind === "add"
                ? "var(--color-success, #10b981)"
                : l.kind === "remove"
                  ? "var(--color-danger, #ef4444)"
                  : "var(--color-muted)";
            const sigil = l.kind === "add" ? "+" : l.kind === "remove" ? "-" : " ";
            return (
              <div key={`${i}-${l.kind}`} style={{ color }} data-kind={l.kind}>
                {sigil}
                {l.text}
              </div>
            );
          })}
        </pre>
      )}
      <footer className="mt-2 flex justify-end gap-2">
        <button
          type="button"
          data-testid="tool-diff-reject"
          disabled={busy}
          onClick={() => runDecision("reject")}
          className="rounded border border-[var(--color-border)] px-3 py-1 text-xs hover:bg-[var(--color-surface-subtle)] disabled:opacity-40"
        >
          Reject
        </button>
        <button
          type="button"
          data-testid="tool-diff-accept"
          disabled={busy}
          onClick={() => runDecision(approveAll ? "accept_all" : "accept")}
          className="rounded bg-[var(--color-accent)] px-3 py-1 text-white text-xs hover:opacity-90 disabled:opacity-40"
        >
          Accept
        </button>
      </footer>
    </section>
  );
}
