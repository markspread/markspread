// MAR-1011: tool-approval queue store tests.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const invokeMock = vi.fn();
vi.mock("@tauri-apps/api/core", () => ({
  invoke: (...args: unknown[]) => invokeMock(...args),
}));

import { type DiffProposal, flushQueue, useToolApprovalQueue } from "./tool-approval-queue";

function makeProposal(
  overrides: Partial<DiffProposal> = {},
): Omit<DiffProposal, "id" | "createdAt"> {
  return {
    sessionId: overrides.sessionId ?? "s1",
    agentId: overrides.agentId ?? "claude-subscription",
    toolCallId: overrides.toolCallId ?? "tc-1",
    requestId: overrides.requestId ?? 42,
    tool: overrides.tool ?? "write_file",
    filePath: overrides.filePath ?? "/notes/a.md",
    before: overrides.before ?? "old",
    after: overrides.after ?? "new",
  };
}

function reset() {
  useToolApprovalQueue.getState()._reset();
  invokeMock.mockReset();
  invokeMock.mockResolvedValue(undefined);
}

describe("tool-approval-queue store", () => {
  beforeEach(reset);
  afterEach(reset);

  it("enqueue stamps id+createdAt and appends to the queue", () => {
    const p = useToolApprovalQueue.getState().enqueue(makeProposal());
    expect(p.id).toBeTruthy();
    expect(p.createdAt).toBeGreaterThan(0);
    expect(useToolApprovalQueue.getState().queue).toHaveLength(1);
  });

  it("enqueue accepts a caller-supplied id", () => {
    const p = useToolApprovalQueue.getState().enqueue({ ...makeProposal(), id: "fixed-id" });
    expect(p.id).toBe("fixed-id");
  });

  it("decide(accept) removes the entry and forwards `allow` to Rust", async () => {
    const p = useToolApprovalQueue.getState().enqueue(makeProposal());
    await useToolApprovalQueue.getState().decide(p.id, "accept");
    expect(useToolApprovalQueue.getState().queue).toHaveLength(0);
    expect(invokeMock).toHaveBeenCalledWith(
      "acp_approve_diff",
      expect.objectContaining({ decision: "allow" }),
    );
  });

  it("decide(reject) forwards `deny`", async () => {
    const p = useToolApprovalQueue.getState().enqueue(makeProposal());
    await useToolApprovalQueue.getState().decide(p.id, "reject");
    expect(invokeMock).toHaveBeenCalledWith(
      "acp_approve_diff",
      expect.objectContaining({ decision: "deny" }),
    );
  });

  it("decide(accept_all) sets the per-session flag", async () => {
    const p = useToolApprovalQueue.getState().enqueue(makeProposal({ sessionId: "ses-A" }));
    await useToolApprovalQueue.getState().decide(p.id, "accept_all");
    expect(useToolApprovalQueue.getState().approveAllBySession["ses-A"]).toBe(true);
  });

  it("decide is a no-op for unknown ids", async () => {
    await useToolApprovalQueue.getState().decide("does-not-exist", "accept");
    expect(invokeMock).not.toHaveBeenCalled();
  });

  it("decide tolerates Rust failure but still drains the queue", async () => {
    const p = useToolApprovalQueue.getState().enqueue(makeProposal());
    invokeMock.mockRejectedValueOnce(new Error("ipc down"));
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    await useToolApprovalQueue.getState().decide(p.id, "accept");
    expect(useToolApprovalQueue.getState().queue).toHaveLength(0);
    warn.mockRestore();
  });

  it("decide forwards a string requestId under requestIdString", async () => {
    const p = useToolApprovalQueue.getState().enqueue(makeProposal({ requestId: "abc-uuid" }));
    await useToolApprovalQueue.getState().decide(p.id, "accept");
    expect(invokeMock).toHaveBeenCalledWith(
      "acp_approve_diff",
      expect.objectContaining({
        requestId: { requestIdString: "abc-uuid" },
      }),
    );
  });

  it("setApproveAll toggles the flag explicitly", () => {
    useToolApprovalQueue.getState().setApproveAll("s2", true);
    expect(useToolApprovalQueue.getState().approveAllBySession.s2).toBe(true);
    useToolApprovalQueue.getState().setApproveAll("s2", false);
    expect(useToolApprovalQueue.getState().approveAllBySession.s2).toBe(false);
  });

  it("load() pulls a persisted queue back into state", async () => {
    invokeMock.mockResolvedValueOnce([
      {
        id: "fromdisk",
        sessionId: "s1",
        agentId: "claude-subscription",
        toolCallId: "tc",
        requestId: 1,
        tool: "edit_file",
        filePath: "/a",
        before: "x",
        after: "y",
        createdAt: 1,
      },
    ]);
    await useToolApprovalQueue.getState().load("/ws");
    expect(useToolApprovalQueue.getState().queue[0]?.id).toBe("fromdisk");
  });

  it("load() ignores a non-array response", async () => {
    invokeMock.mockResolvedValueOnce({ broken: true });
    await useToolApprovalQueue.getState().load("/ws");
    expect(useToolApprovalQueue.getState().queue).toHaveLength(0);
  });

  it("load() tolerates IPC failure", async () => {
    invokeMock.mockRejectedValueOnce(new Error("read fail"));
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    await useToolApprovalQueue.getState().load("/ws");
    expect(useToolApprovalQueue.getState().queue).toHaveLength(0);
    warn.mockRestore();
  });

  it("flushQueue persists when given a workspace id", async () => {
    await flushQueue("/ws", []);
    expect(invokeMock).toHaveBeenCalledWith("tool_queue_save", expect.any(Object));
  });

  it("flushQueue is a no-op without a workspace id", async () => {
    await flushQueue(null, []);
    expect(invokeMock).not.toHaveBeenCalled();
  });

  it("flushQueue tolerates IPC failure", async () => {
    invokeMock.mockRejectedValueOnce(new Error("write fail"));
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    await flushQueue("/ws", []);
    warn.mockRestore();
  });
});
