// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn(async () => undefined),
}));

import { type AcpAdapter, resetAcpAdapter, setAcpAdapter } from "../../lib/agents/acp-adapter";
import { useAgentRegistry } from "../../store/agent-registry";
import { _cancelChatFlush, useChatSessions } from "../../store/chat-sessions";
import { subscribeTelemetry, useTelemetry } from "../../store/telemetry";
import { useToolApprovalQueue } from "../../store/tool-approval-queue";
import { useWorkspace } from "../../store/workspace";
import { ChatShell } from "../ChatShell";

function fakeAdapter(overrides: Partial<AcpAdapter> = {}): AcpAdapter {
  return {
    startSession: vi.fn(async () => "fake-sess"),
    sendMessage: vi.fn(async () => {}),
    approveTool: vi.fn(async () => {}),
    ...overrides,
  };
}

function resetStores() {
  useChatSessions.getState()._reset();
  _cancelChatFlush();
  useWorkspace.setState({ current: "/ws-1", preferredShell: "chat" });
  useTelemetry.setState({ consent: "enabled" });
  useAgentRegistry.getState()._reset();
  useToolApprovalQueue.getState()._reset();
  resetAcpAdapter();
}

afterEach(() => {
  cleanup();
  useChatSessions.getState()._reset();
  _cancelChatFlush();
  useWorkspace.setState({ current: null, preferredShell: "chat" });
  useTelemetry.setState({ consent: "unset" });
  useAgentRegistry.getState()._reset();
  useToolApprovalQueue.getState()._reset();
  resetAcpAdapter();
});

describe("ChatShell", () => {
  beforeEach(resetStores);

  it("mounts the three columns and auto-creates a session", () => {
    const { getByTestId } = render(<ChatShell />);
    expect(getByTestId("chat-workspace-nav")).toBeTruthy();
    expect(getByTestId("chat-stream-region")).toBeTruthy();
    expect(getByTestId("chat-context-panel")).toBeTruthy();
    expect(useChatSessions.getState().activeSessionId).not.toBeNull();
  });

  it("emits shell.mounted on first paint", () => {
    const events: { type: string }[] = [];
    const off = subscribeTelemetry((e) => events.push(e));
    render(<ChatShell />);
    expect(events.some((e) => e.type === "shell.mounted")).toBe(true);
    off();
  });

  it("collapse buttons hide and re-show the side panels", () => {
    const { getByTestId, queryByTestId } = render(<ChatShell />);
    fireEvent.click(getByTestId("chat-toggle-nav"));
    expect(queryByTestId("chat-workspace-nav")).toBeNull();
    fireEvent.click(getByTestId("chat-toggle-context"));
    expect(queryByTestId("chat-context-panel")).toBeNull();
    fireEvent.click(getByTestId("chat-toggle-nav"));
    fireEvent.click(getByTestId("chat-toggle-context"));
    expect(queryByTestId("chat-workspace-nav")).toBeTruthy();
    expect(queryByTestId("chat-context-panel")).toBeTruthy();
  });

  it("switch-to-editor sets preferredShell + emits the events", () => {
    const events: { type: string }[] = [];
    const off = subscribeTelemetry((e) => events.push(e));
    const { getByTestId } = render(<ChatShell />);
    fireEvent.click(getByTestId("chat-switch-editor"));
    expect(useWorkspace.getState().preferredShell).toBe("editor");
    expect(events.some((e) => e.type === "shell.switched")).toBe(true);
    expect(events.some((e) => e.type === "editor.opened_via_escape_hatch")).toBe(true);
    off();
  });

  it("sending a message routes user text to the ACP adapter (subscription agent)", async () => {
    const adapter = fakeAdapter();
    setAcpAdapter(adapter);
    const { getByTestId } = render(<ChatShell />);
    fireEvent.change(getByTestId("chat-input"), { target: { value: "hi" } });
    fireEvent.click(getByTestId("chat-send"));
    await waitFor(() => expect(adapter.startSession).toHaveBeenCalled());
    expect(adapter.sendMessage).toHaveBeenCalledWith("fake-sess", "hi");
    expect(getByTestId("chat-msg-user").textContent).toContain("hi");
  });

  it("api-key agent bypasses the ACP adapter and prints a legacy notice", async () => {
    const adapter = fakeAdapter();
    setAcpAdapter(adapter);
    // Force the workspace default to api-key BEFORE the first session is auto-created.
    useAgentRegistry.getState().setWorkspaceDefault("/ws-1", "claude-api-key");
    const { getByTestId, container } = render(<ChatShell />);
    fireEvent.change(getByTestId("chat-input"), { target: { value: "yo" } });
    fireEvent.click(getByTestId("chat-send"));
    await waitFor(() => {
      const txt = container.textContent ?? "";
      expect(txt).toContain("api-key agent");
    });
    expect(adapter.startSession).not.toHaveBeenCalled();
  });

  it("adapter errors surface as a system message", async () => {
    const adapter = fakeAdapter({
      startSession: vi.fn(async () => {
        throw new Error("spawn failed");
      }),
    });
    setAcpAdapter(adapter);
    const { getByTestId, container } = render(<ChatShell />);
    fireEvent.change(getByTestId("chat-input"), { target: { value: "x" } });
    fireEvent.click(getByTestId("chat-send"));
    await waitFor(() => {
      expect(container.textContent ?? "").toContain("Agent error");
    });
  });

  it("non-Error adapter rejection still produces a system message", async () => {
    const adapter = fakeAdapter({
      sendMessage: vi.fn(async () => {
        throw "boom-string";
      }),
    });
    setAcpAdapter(adapter);
    const { getByTestId, container } = render(<ChatShell />);
    fireEvent.change(getByTestId("chat-input"), { target: { value: "x" } });
    fireEvent.click(getByTestId("chat-send"));
    await waitFor(() => {
      expect(container.textContent ?? "").toContain("boom-string");
    });
  });

  it("re-uses the cached ACP session id on the second message", async () => {
    const adapter = fakeAdapter();
    setAcpAdapter(adapter);
    const { getByTestId } = render(<ChatShell />);
    fireEvent.change(getByTestId("chat-input"), { target: { value: "one" } });
    fireEvent.click(getByTestId("chat-send"));
    await waitFor(() => expect(adapter.sendMessage).toHaveBeenCalledTimes(1));
    fireEvent.change(getByTestId("chat-input"), { target: { value: "two" } });
    fireEvent.click(getByTestId("chat-send"));
    await waitFor(() => expect(adapter.sendMessage).toHaveBeenCalledTimes(2));
    // startSession only invoked once total.
    expect(adapter.startSession).toHaveBeenCalledTimes(1);
  });

  it("sending with no registered agent prints a system fallback", async () => {
    setAcpAdapter(fakeAdapter());
    useAgentRegistry.setState({ byId: {}, order: [] });
    const { getByTestId, container } = render(<ChatShell />);
    fireEvent.change(getByTestId("chat-input"), { target: { value: "x" } });
    fireEvent.click(getByTestId("chat-send"));
    await waitFor(() => {
      expect(container.textContent ?? "").toContain("No agent registered");
    });
  });

  it("renders queued tool-diff cards above the chat stream", () => {
    useToolApprovalQueue.getState().enqueue({
      sessionId: "s1",
      agentId: "claude-subscription",
      toolCallId: "tc",
      requestId: 1,
      tool: "write_file",
      filePath: "/a.md",
      before: "a",
      after: "b",
    });
    const { getByTestId } = render(<ChatShell />);
    expect(getByTestId("chat-tool-queue")).toBeTruthy();
    expect(getByTestId("tool-diff-dialog")).toBeTruthy();
  });

  it("re-selects an existing session when one is already created", () => {
    const existing = useChatSessions.getState().createSession("/ws-1", "existing");
    useChatSessions.setState({ activeSessionId: null });
    render(<ChatShell />);
    expect(useChatSessions.getState().activeSessionId).toBe(existing.id);
  });

  it("uses workspaceIdOverride when supplied", () => {
    const { getByTestId } = render(<ChatShell workspaceIdOverride="/other" />);
    expect(getByTestId("chat-toolbar").textContent).toContain("/other");
  });

  it("renders placeholder when workspaceId is empty", () => {
    useWorkspace.setState({ current: null, preferredShell: "chat" });
    const { getByTestId } = render(<ChatShell />);
    expect(getByTestId("chat-toolbar").textContent).toContain("(no workspace)");
    expect(useChatSessions.getState().activeSessionId).toBeNull();
  });

  it("creating a new session from the nav adds another entry", () => {
    const { getByTestId } = render(<ChatShell />);
    const initial = useChatSessions.getState().byWorkspace["/ws-1"]?.length ?? 0;
    fireEvent.click(getByTestId("chat-new-session"));
    const after = useChatSessions.getState().byWorkspace["/ws-1"]?.length ?? 0;
    expect(after).toBe(initial + 1);
  });

  it("selecting a session through the nav makes it active", () => {
    const { getByTestId } = render(<ChatShell />);
    const wsList = useChatSessions.getState().byWorkspace["/ws-1"] ?? [];
    expect(wsList.length).toBeGreaterThan(0);
    act(() => {
      useChatSessions.getState().createSession("/ws-1", "Second");
    });
    const all = useChatSessions.getState().byWorkspace["/ws-1"] ?? [];
    const other = all.find((id) => id !== useChatSessions.getState().activeSessionId);
    if (!other) throw new Error("expected a second session");
    fireEvent.click(getByTestId(`chat-session-${other}`));
    expect(useChatSessions.getState().activeSessionId).toBe(other);
  });
});
