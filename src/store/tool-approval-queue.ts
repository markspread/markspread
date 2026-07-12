// MAR-1011: pending tool-call diff queue.
//
// When an ACP agent asks for permission to write/edit a file, we don't
// auto-allow. Instead the call goes into this queue and surfaces in the
// ToolDiffDialog. Decisions are forwarded back to Rust through
// `acp_approve_diff` (which then sends the underlying ACP response).
//
// The queue is *in-memory only* — a queued `session/request_permission`
// references a live JSON-RPC request id owned by the running agent
// process, so persisting it across restarts could never be honored
// (the former `tool_queue_save`/`tool_queue_load` stubs were removed).
//
// Per-session "approve all" flag bypasses the dialog for the remainder
// of the session — useful for non-destructive bulk edits.

import { invoke } from "@tauri-apps/api/core";
import { create } from "zustand";

export type ToolDecision = "accept" | "reject" | "accept_all";

export type DiffToolKind = "write_file" | "edit_file" | "apply_patch";

export interface DiffProposal {
  /** Unique id for the queue entry — same shape Rust gives us. */
  id: string;
  sessionId: string;
  agentId: string;
  toolCallId: string;
  /** The originating ACP request id (`session/request_permission`). */
  requestId: number | string;
  tool: DiffToolKind;
  filePath: string;
  before: string;
  after: string;
  /** Agent-authored human summary of the requested change (may be ""). */
  summary?: string;
  createdAt: number;
}

interface ToolApprovalQueueState {
  queue: DiffProposal[];
  /** Per-session approve-all flag. */
  approveAllBySession: Record<string, boolean>;
  _reset: () => void;
  enqueue: (p: Omit<DiffProposal, "id" | "createdAt"> & { id?: string }) => DiffProposal;
  decide: (proposalId: string, decision: ToolDecision) => Promise<void>;
  setApproveAll: (sessionId: string, value: boolean) => void;
}

function randomId(): string {
  return globalThis.crypto.randomUUID().slice(0, 12);
}

export const useToolApprovalQueue = create<ToolApprovalQueueState>((set, get) => ({
  queue: [],
  approveAllBySession: {},
  _reset: () => set({ queue: [], approveAllBySession: {} }),
  enqueue: (p) => {
    const proposal: DiffProposal = {
      id: p.id ?? randomId(),
      sessionId: p.sessionId,
      agentId: p.agentId,
      toolCallId: p.toolCallId,
      requestId: p.requestId,
      tool: p.tool,
      filePath: p.filePath,
      before: p.before,
      after: p.after,
      ...(p.summary !== undefined ? { summary: p.summary } : {}),
      createdAt: Date.now(),
    };
    set((s) => ({ queue: [...s.queue, proposal] }));
    return proposal;
  },
  decide: async (proposalId, decision) => {
    const proposal = get().queue.find((q) => q.id === proposalId);
    if (!proposal) return;
    set((s) => ({ queue: s.queue.filter((q) => q.id !== proposalId) }));
    if (decision === "accept_all") {
      set((s) => ({
        approveAllBySession: { ...s.approveAllBySession, [proposal.sessionId]: true },
      }));
    }
    try {
      await invoke("acp_approve_diff", {
        sessionId: proposal.sessionId,
        requestId:
          typeof proposal.requestId === "number"
            ? { requestIdNumber: proposal.requestId }
            : { requestIdString: proposal.requestId },
        decision: decision === "reject" ? "deny" : "allow",
      });
    } catch (e) {
      console.warn("[tool-queue] decide failed", e);
    }
  },
  setApproveAll: (sessionId, value) =>
    set((s) => ({ approveAllBySession: { ...s.approveAllBySession, [sessionId]: value } })),
}));
