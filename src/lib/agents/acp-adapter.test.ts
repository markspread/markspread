// MAR-1009: ACP adapter wrapper tests — verifies argument shapes for
// the three Tauri commands and the test-seam swap-in/restore behaviour.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const invokeMock = vi.fn();
vi.mock("@tauri-apps/api/core", () => ({
  invoke: (...args: unknown[]) => invokeMock(...args),
}));

import { type AcpAdapter, getAcpAdapter, resetAcpAdapter, setAcpAdapter } from "./acp-adapter";
import type { RegisteredAgent } from "./types";

const claude: RegisteredAgent = {
  id: "claude-subscription",
  label: "Claude",
  kind: "acp-builtin",
  transport: { command: "claude", args: ["--acp"], auth: "subscription" },
};

const apiKeyAgent: RegisteredAgent = {
  id: "claude-api-key",
  label: "Claude (api key)",
  kind: "api-key",
};

function reset() {
  invokeMock.mockReset();
  invokeMock.mockResolvedValue(undefined);
  resetAcpAdapter();
}

describe("acp-adapter", () => {
  beforeEach(reset);
  afterEach(reset);

  it("startSession invokes acp_start_session with agent id + workspace root", async () => {
    invokeMock.mockResolvedValueOnce({ sessionId: "sess-1" });
    const id = await getAcpAdapter().startSession(claude, "/ws");
    expect(id).toBe("sess-1");
    expect(invokeMock).toHaveBeenCalledWith("acp_start_session", {
      agentId: "claude-subscription",
      workspaceRoot: "/ws",
    });
  });

  it("startSession rejects when the agent is api-key", async () => {
    await expect(getAcpAdapter().startSession(apiKeyAgent, "/ws")).rejects.toThrow(/api-key/);
  });

  it("sendMessage forwards sessionId + content", async () => {
    await getAcpAdapter().sendMessage("sess-1", "hello");
    expect(invokeMock).toHaveBeenCalledWith("acp_send_message", {
      sessionId: "sess-1",
      content: "hello",
    });
  });

  it("approveTool uses requestIdNumber for numeric ids", async () => {
    await getAcpAdapter().approveTool("sess-1", 42, "allow");
    expect(invokeMock).toHaveBeenCalledWith("acp_approve_tool", {
      sessionId: "sess-1",
      decision: { requestIdNumber: 42, decision: "allow" },
    });
  });

  it("approveTool uses requestIdString for string ids", async () => {
    await getAcpAdapter().approveTool("sess-1", "abc", "deny");
    expect(invokeMock).toHaveBeenCalledWith("acp_approve_tool", {
      sessionId: "sess-1",
      decision: { requestIdString: "abc", decision: "deny" },
    });
  });

  it("setAcpAdapter swaps the adapter and resetAcpAdapter restores it", async () => {
    const fake: AcpAdapter = {
      startSession: vi.fn(async () => "fake-sess"),
      sendMessage: vi.fn(async () => {}),
      approveTool: vi.fn(async () => {}),
    };
    setAcpAdapter(fake);
    const id = await getAcpAdapter().startSession(claude, "/ws");
    expect(id).toBe("fake-sess");
    expect(fake.startSession).toHaveBeenCalled();
    resetAcpAdapter();
    invokeMock.mockResolvedValueOnce({ sessionId: "real" });
    expect(await getAcpAdapter().startSession(claude, "/ws")).toBe("real");
  });
});
