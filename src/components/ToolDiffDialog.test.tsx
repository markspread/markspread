// @vitest-environment jsdom
import { cleanup, fireEvent, render, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const invokeMock = vi.fn();
vi.mock("@tauri-apps/api/core", () => ({
  invoke: (...args: unknown[]) => invokeMock(...args),
}));

import { type DiffProposal, useToolApprovalQueue } from "../store/tool-approval-queue";
import { ToolDiffDialog } from "./ToolDiffDialog";

function makeProposal(): DiffProposal {
  return {
    id: "p1",
    sessionId: "s1",
    agentId: "claude-subscription",
    toolCallId: "tc",
    requestId: 7,
    tool: "edit_file",
    filePath: "/a.md",
    before: "line one\nline two",
    after: "line one\nline two changed\nadded",
    createdAt: 0,
  };
}

function reset() {
  useToolApprovalQueue.getState()._reset();
  invokeMock.mockReset();
  invokeMock.mockResolvedValue(undefined);
}

describe("ToolDiffDialog", () => {
  beforeEach(reset);
  afterEach(() => {
    cleanup();
    reset();
  });

  it("renders the file path + tool kind + at least one + and - line", () => {
    const p = makeProposal();
    useToolApprovalQueue.getState().enqueue({
      sessionId: p.sessionId,
      agentId: p.agentId,
      toolCallId: p.toolCallId,
      requestId: p.requestId,
      tool: p.tool,
      filePath: p.filePath,
      before: p.before,
      after: p.after,
      id: p.id,
    });
    const { getByTestId, container } = render(<ToolDiffDialog proposal={p} />);
    expect(getByTestId("tool-diff-tool").textContent).toBe("edit_file");
    expect(getByTestId("tool-diff-path").textContent).toBe("/a.md");
    expect(container.querySelector('[data-kind="add"]')).toBeTruthy();
    expect(container.querySelector('[data-kind="remove"]')).toBeTruthy();
  });

  it("Accept dispatches `accept` and triggers onDone", async () => {
    const p = makeProposal();
    useToolApprovalQueue.getState().enqueue({
      sessionId: p.sessionId,
      agentId: p.agentId,
      toolCallId: p.toolCallId,
      requestId: p.requestId,
      tool: p.tool,
      filePath: p.filePath,
      before: p.before,
      after: p.after,
      id: p.id,
    });
    const onDone = vi.fn();
    const { getByTestId } = render(<ToolDiffDialog proposal={p} onDone={onDone} />);
    fireEvent.click(getByTestId("tool-diff-accept"));
    await waitFor(() => expect(onDone).toHaveBeenCalled());
    expect(invokeMock).toHaveBeenCalledWith(
      "acp_approve_diff",
      expect.objectContaining({ decision: "allow" }),
    );
  });

  it("Reject dispatches `deny`", async () => {
    const p = makeProposal();
    useToolApprovalQueue.getState().enqueue({
      sessionId: p.sessionId,
      agentId: p.agentId,
      toolCallId: p.toolCallId,
      requestId: p.requestId,
      tool: p.tool,
      filePath: p.filePath,
      before: p.before,
      after: p.after,
      id: p.id,
    });
    const { getByTestId } = render(<ToolDiffDialog proposal={p} />);
    fireEvent.click(getByTestId("tool-diff-reject"));
    await waitFor(() => {
      expect(invokeMock).toHaveBeenCalledWith(
        "acp_approve_diff",
        expect.objectContaining({ decision: "deny" }),
      );
    });
  });

  it("Approve-all checkbox upgrades the accept to accept_all", async () => {
    const p = makeProposal();
    useToolApprovalQueue.getState().enqueue({
      sessionId: p.sessionId,
      agentId: p.agentId,
      toolCallId: p.toolCallId,
      requestId: p.requestId,
      tool: p.tool,
      filePath: p.filePath,
      before: p.before,
      after: p.after,
      id: p.id,
    });
    const { getByTestId } = render(<ToolDiffDialog proposal={p} />);
    fireEvent.click(getByTestId("tool-diff-approve-all"));
    fireEvent.click(getByTestId("tool-diff-accept"));
    await waitFor(() => {
      expect(useToolApprovalQueue.getState().approveAllBySession.s1).toBe(true);
    });
  });

  it("works without an onDone callback", async () => {
    const p = makeProposal();
    useToolApprovalQueue.getState().enqueue({
      sessionId: p.sessionId,
      agentId: p.agentId,
      toolCallId: p.toolCallId,
      requestId: p.requestId,
      tool: p.tool,
      filePath: p.filePath,
      before: p.before,
      after: p.after,
      id: p.id,
    });
    const { getByTestId } = render(<ToolDiffDialog proposal={p} />);
    fireEvent.click(getByTestId("tool-diff-accept"));
    await waitFor(() => expect(useToolApprovalQueue.getState().queue).toHaveLength(0));
  });
});
