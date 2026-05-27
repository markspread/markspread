// MAR-1011: pending tool-call diff queue with persistence.
//
// When an ACP agent asks for permission to write/edit a file, we don't
// auto-allow. Instead the call goes into this queue and surfaces in the
// ToolDiffDialog. Decisions are forwarded back to Rust through
// `acp_approve_diff` (which then sends the underlying ACP response).
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
  load: (workspaceId: string) => Promise<void>;
}

function randomId(): string {
  return globalThis.crypto.randomUUID().slice(0, 12);
}

async function persist(workspaceId: string | null, queue: DiffProposal[]): Promise<void> {
  if (!workspaceId) return;
  try {
    await invoke("tool_queue_save", { workspaceId, queue });
  } catch (e) {
    console.warn("[tool-queue] save failed", e);
  }
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
  load: async (workspaceId) => {
    try {
      const loaded = await invoke<DiffProposal[]>("tool_queue_load", { workspaceId });
      if (Array.isArray(loaded)) {
        set({ queue: loaded });
      }
    } catch (e) {
      console.warn("[tool-queue] load failed", e);
    }
  },
}));

/** Expose persistence for the ChatShell to call on `queue` change. */
export async function flushQueue(workspaceId: string | null, queue: DiffProposal[]): Promise<void> {
  await persist(workspaceId, queue);
}
