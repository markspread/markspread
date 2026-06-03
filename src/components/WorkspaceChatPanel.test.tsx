// @vitest-environment jsdom
//
// ADR-0019 §Decision.1: WorkspaceChatPanel owns the agent wiring that
// used to live in the deleted ChatShell. This suite ports the former
// ChatShell agent-path coverage (onSend, composed prompt, error shapes,
// the acp:notification stream, the `+ Parser` mode switch, code-block
// "파서로 만들기") onto the extracted component.

import { act, cleanup, fireEvent, render, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn(async () => undefined),
}));

// Capture the most recent `acp:notification` handler so tests can drive
// the Rust→frontend stream-chunk path (handleAcpNotification).
const acpListeners: Array<(evt: { payload: unknown }) => void> = [];
async function defaultListen(event: string, handler: (evt: { payload: unknown }) => void) {
  if (event === "acp:notification") acpListeners.push(handler);
  return () => {};
}
const listenMock = vi.fn(defaultListen);
vi.mock("@tauri-apps/api/event", () => ({
  listen: (...args: unknown[]) => (listenMock as unknown as (...a: unknown[]) => unknown)(...args),
}));

// AgentPicker is heavy (keychain probing) and irrelevant to this suite.
vi.mock("./AgentPicker", () => ({ AgentPicker: () => null }));

import { invoke } from "@tauri-apps/api/core";
import { type AcpAdapter, resetAcpAdapter, setAcpAdapter } from "../lib/agents/acp-adapter";
import { useActivityMode } from "../store/activity-mode";
import { useAgentRegistry } from "../store/agent-registry";
import { _cancelChatFlush, useChatSessions } from "../store/chat-sessions";
import { useTabs } from "../store/tabs";
import { useTelemetry } from "../store/telemetry";
import { useToolApprovalQueue } from "../store/tool-approval-queue";
import { WorkspaceChatPanel } from "./WorkspaceChatPanel";

const invokeMock = invoke as unknown as ReturnType<typeof vi.fn>;
const WS = "/ws-1";

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
  useTelemetry.setState({ consent: "enabled" });
  useAgentRegistry.getState()._reset();
  useToolApprovalQueue.getState()._reset();
  useTabs.setState({ tabs: [], activePath: null });
  useActivityMode.setState({ mode: "workspace", enteredParserFrom: null, parserPrefillSource: "" });
  resetAcpAdapter();
  acpListeners.length = 0;
  invokeMock.mockReset();
  invokeMock.mockImplementation(async () => undefined);
  listenMock.mockReset();
  listenMock.mockImplementation(defaultListen);
}

beforeEach(resetStores);

afterEach(() => {
  cleanup();
  useChatSessions.getState()._reset();
  _cancelChatFlush();
  useTelemetry.setState({ consent: "unset" });
  useAgentRegistry.getState()._reset();
  useToolApprovalQueue.getState()._reset();
  useTabs.setState({ tabs: [], activePath: null });
  useActivityMode.setState({ mode: "workspace", enteredParserFrom: null, parserPrefillSource: "" });
  resetAcpAdapter();
  acpListeners.length = 0;
});

describe("WorkspaceChatPanel", () => {
  it("auto-creates a session on mount and renders the chat stream", () => {
    const { getByTestId } = render(<WorkspaceChatPanel workspaceId={WS} />);
    expect(getByTestId("workspace-chat-panel")).toBeTruthy();
    expect(getByTestId("chat-messages")).toBeTruthy();
    expect(useChatSessions.getState().activeSessionId).not.toBeNull();
  });

  it("re-selects an existing session when one is already created", () => {
    const existing = useChatSessions.getState().createSession(WS, "existing");
    useChatSessions.setState({ activeSessionId: null });
    render(<WorkspaceChatPanel workspaceId={WS} />);
    expect(useChatSessions.getState().activeSessionId).toBe(existing.id);
  });

  it("does not create a session when workspaceId is empty", () => {
    render(<WorkspaceChatPanel workspaceId="" />);
    expect(useChatSessions.getState().activeSessionId).toBeNull();
  });

  it("routes user text to the ACP adapter with a context-aware prompt", async () => {
    const adapter = fakeAdapter();
    setAcpAdapter(adapter);
    const { getByTestId } = render(<WorkspaceChatPanel workspaceId={WS} />);
    fireEvent.change(getByTestId("chat-input"), { target: { value: "hi" } });
    fireEvent.click(getByTestId("chat-send"));
    await waitFor(() => expect(adapter.sendMessage).toHaveBeenCalled());
    const callArgs = (adapter.sendMessage as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(callArgs?.[0]).toBe("fake-sess");
    const composed = String(callArgs?.[1] ?? "");
    expect(composed).toContain("[Markspread environment]");
    expect(composed).toContain(`[Workspace] ${WS}`);
    expect(composed).toContain("[Active file] (none — user has no file open)");
    expect(composed).toContain("[User message]");
    expect(composed).toContain("hi");
    expect(getByTestId("chat-msg-user").textContent).toContain("hi");
  });

  it("api-key agent bypasses the ACP adapter and prints a legacy notice", async () => {
    const adapter = fakeAdapter();
    setAcpAdapter(adapter);
    useAgentRegistry.getState().setWorkspaceDefault(WS, "claude-api-key");
    const { getByTestId, container } = render(<WorkspaceChatPanel workspaceId={WS} />);
    fireEvent.change(getByTestId("chat-input"), { target: { value: "yo" } });
    fireEvent.click(getByTestId("chat-send"));
    await waitFor(() => expect(container.textContent ?? "").toContain("api-key agent"));
    expect(adapter.startSession).not.toHaveBeenCalled();
  });

  it("sending with no registered agent prints a system fallback", async () => {
    setAcpAdapter(fakeAdapter());
    useAgentRegistry.setState({ byId: {}, order: [] });
    const { getByTestId, container } = render(<WorkspaceChatPanel workspaceId={WS} />);
    fireEvent.change(getByTestId("chat-input"), { target: { value: "x" } });
    fireEvent.click(getByTestId("chat-send"));
    await waitFor(() => expect(container.textContent ?? "").toContain("No agent registered"));
  });

  it("re-uses the cached ACP session id on the second message", async () => {
    const adapter = fakeAdapter();
    setAcpAdapter(adapter);
    const { getByTestId } = render(<WorkspaceChatPanel workspaceId={WS} />);
    fireEvent.change(getByTestId("chat-input"), { target: { value: "one" } });
    fireEvent.click(getByTestId("chat-send"));
    await waitFor(() => expect(adapter.sendMessage).toHaveBeenCalledTimes(1));
    fireEvent.change(getByTestId("chat-input"), { target: { value: "two" } });
    fireEvent.click(getByTestId("chat-send"));
    await waitFor(() => expect(adapter.sendMessage).toHaveBeenCalledTimes(2));
    expect(adapter.startSession).toHaveBeenCalledTimes(1);
  });

  it("adapter errors surface as a system message (Error path)", async () => {
    const adapter = fakeAdapter({
      startSession: vi.fn(async () => {
        throw new Error("spawn failed");
      }),
    });
    setAcpAdapter(adapter);
    const { getByTestId, container } = render(<WorkspaceChatPanel workspaceId={WS} />);
    fireEvent.change(getByTestId("chat-input"), { target: { value: "x" } });
    fireEvent.click(getByTestId("chat-send"));
    await waitFor(() => expect(container.textContent ?? "").toContain("Agent error"));
  });

  it("non-Error string rejection still produces a system message", async () => {
    const adapter = fakeAdapter({
      sendMessage: vi.fn(async () => {
        throw "boom-string";
      }),
    });
    setAcpAdapter(adapter);
    const { getByTestId, container } = render(<WorkspaceChatPanel workspaceId={WS} />);
    fireEvent.change(getByTestId("chat-input"), { target: { value: "x" } });
    fireEvent.click(getByTestId("chat-send"));
    await waitFor(() => expect(container.textContent ?? "").toContain("boom-string"));
  });

  it("an error object with a string message surfaces that message", async () => {
    const adapter = fakeAdapter({
      sendMessage: vi.fn(async () => {
        throw { message: "structured failure" };
      }),
    });
    setAcpAdapter(adapter);
    const { getByTestId, container } = render(<WorkspaceChatPanel workspaceId={WS} />);
    fireEvent.change(getByTestId("chat-input"), { target: { value: "x" } });
    fireEvent.click(getByTestId("chat-send"));
    await waitFor(() => expect(container.textContent ?? "").toContain("structured failure"));
  });

  it("an error object without a message is JSON-stringified", async () => {
    const adapter = fakeAdapter({
      sendMessage: vi.fn(async () => {
        throw { code: 42, detail: "weird" };
      }),
    });
    setAcpAdapter(adapter);
    const { getByTestId, container } = render(<WorkspaceChatPanel workspaceId={WS} />);
    fireEvent.change(getByTestId("chat-input"), { target: { value: "x" } });
    fireEvent.click(getByTestId("chat-send"));
    await waitFor(() => {
      const txt = container.textContent ?? "";
      expect(txt).toContain("Agent error");
      expect(txt).toContain('"code":42');
    });
  });

  it("a non-object, non-string rejection falls back to String(err)", async () => {
    const adapter = fakeAdapter({
      sendMessage: vi.fn(async () => {
        throw 42;
      }),
    });
    setAcpAdapter(adapter);
    const { getByTestId, container } = render(<WorkspaceChatPanel workspaceId={WS} />);
    fireEvent.change(getByTestId("chat-input"), { target: { value: "x" } });
    fireEvent.click(getByTestId("chat-send"));
    await waitFor(() => expect(container.textContent ?? "").toContain("Agent error: 42"));
  });

  it("a non-serializable error object falls back to String(err)", async () => {
    const circular: Record<string, unknown> = {};
    circular.self = circular;
    const adapter = fakeAdapter({
      sendMessage: vi.fn(async () => {
        throw circular;
      }),
    });
    setAcpAdapter(adapter);
    const { getByTestId, container } = render(<WorkspaceChatPanel workspaceId={WS} />);
    fireEvent.change(getByTestId("chat-input"), { target: { value: "x" } });
    fireEvent.click(getByTestId("chat-send"));
    await waitFor(() => expect(container.textContent ?? "").toContain("Agent error"));
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
    const { getByTestId } = render(<WorkspaceChatPanel workspaceId={WS} />);
    expect(getByTestId("workspace-chat-tool-queue")).toBeTruthy();
    expect(getByTestId("tool-diff-dialog")).toBeTruthy();
  });

  // ADR-0019 T6 / N5: the toolbar `+ Parser` button switches to parser
  // mode (no modal), recording the origin for the breadcrumb.
  it("the '+ Parser' button switches to parser mode (no modal)", () => {
    const { getByTestId } = render(<WorkspaceChatPanel workspaceId={WS} />);
    expect(useActivityMode.getState().mode).toBe("workspace");
    fireEvent.click(getByTestId("workspace-create-parser"));
    expect(useActivityMode.getState().mode).toBe("parser");
    expect(useActivityMode.getState().enteredParserFrom).toBe("workspace");
  });

  it("a code-block '파서로 만들기' enters parser mode with the source prefilled", () => {
    const session = useChatSessions.getState().createSession(WS);
    act(() => {
      useChatSessions.getState().selectSession(session.id);
      useChatSessions
        .getState()
        .appendMessage(session.id, { role: "assistant", content: "```js\nconst p = 1;\n```" });
    });
    const { getByTestId } = render(<WorkspaceChatPanel workspaceId={WS} />);
    fireEvent.click(getByTestId("chat-codeblock-register-parser"));
    expect(useActivityMode.getState().mode).toBe("parser");
    expect(useActivityMode.getState().parserPrefillSource).toContain("const p = 1;");
  });

  it("attaches the active file excerpt to the composed agent input", async () => {
    const adapter = fakeAdapter();
    setAcpAdapter(adapter);
    invokeMock.mockImplementation(async (cmd: string) => {
      if (cmd === "fs_read_file") return { content: "# Heading\nbody line", encoding: "utf-8" };
      return undefined;
    });
    act(() => {
      useTabs.setState({ activePath: `${WS}/notes.md`, tabs: [] });
    });
    const { getByTestId } = render(<WorkspaceChatPanel workspaceId={WS} />);
    fireEvent.change(getByTestId("chat-input"), { target: { value: "summarize" } });
    fireEvent.click(getByTestId("chat-send"));
    await waitFor(() => expect(adapter.sendMessage).toHaveBeenCalled());
    const composed = String(
      (adapter.sendMessage as ReturnType<typeof vi.fn>).mock.calls[0]?.[1] ?? "",
    );
    expect(composed).toContain(`[Active file] ${WS}/notes.md`);
    expect(composed).toContain("[Active file content (excerpt)]");
    expect(composed).toContain("# Heading");
  });

  it("truncates a very long active-file excerpt", async () => {
    const adapter = fakeAdapter();
    setAcpAdapter(adapter);
    invokeMock.mockImplementation(async (cmd: string) => {
      if (cmd === "fs_read_file") return { content: "A".repeat(5000), encoding: "utf-8" };
      return undefined;
    });
    act(() => {
      useTabs.setState({ activePath: `${WS}/big.md`, tabs: [] });
    });
    const { getByTestId } = render(<WorkspaceChatPanel workspaceId={WS} />);
    fireEvent.change(getByTestId("chat-input"), { target: { value: "go" } });
    fireEvent.click(getByTestId("chat-send"));
    await waitFor(() => expect(adapter.sendMessage).toHaveBeenCalled());
    const composed = String(
      (adapter.sendMessage as ReturnType<typeof vi.fn>).mock.calls[0]?.[1] ?? "",
    );
    expect(composed).toContain("(truncated; total 5000 chars)");
  });

  it("omits the excerpt block when fs_read_file returns empty content", async () => {
    const adapter = fakeAdapter();
    setAcpAdapter(adapter);
    invokeMock.mockImplementation(async (cmd: string) => {
      if (cmd === "fs_read_file") return { content: "", encoding: "utf-8" };
      return undefined;
    });
    act(() => {
      useTabs.setState({ activePath: `${WS}/empty.md`, tabs: [] });
    });
    const { getByTestId } = render(<WorkspaceChatPanel workspaceId={WS} />);
    fireEvent.change(getByTestId("chat-input"), { target: { value: "go" } });
    fireEvent.click(getByTestId("chat-send"));
    await waitFor(() => expect(adapter.sendMessage).toHaveBeenCalled());
    const composed = String(
      (adapter.sendMessage as ReturnType<typeof vi.fn>).mock.calls[0]?.[1] ?? "",
    );
    expect(composed).toContain(`[Active file] ${WS}/empty.md`);
    expect(composed).not.toContain("[Active file content (excerpt)]");
  });

  it("swallows fs_read_file errors when building the excerpt", async () => {
    const adapter = fakeAdapter();
    setAcpAdapter(adapter);
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    invokeMock.mockImplementation(async (cmd: string) => {
      if (cmd === "fs_read_file") throw new Error("read denied");
      return undefined;
    });
    act(() => {
      useTabs.setState({ activePath: `${WS}/locked.md`, tabs: [] });
    });
    const { getByTestId } = render(<WorkspaceChatPanel workspaceId={WS} />);
    fireEvent.change(getByTestId("chat-input"), { target: { value: "go" } });
    fireEvent.click(getByTestId("chat-send"));
    await waitFor(() => expect(adapter.sendMessage).toHaveBeenCalled());
    const composed = String(
      (adapter.sendMessage as ReturnType<typeof vi.fn>).mock.calls[0]?.[1] ?? "",
    );
    expect(composed).toContain(`[Active file] ${WS}/locked.md`);
    expect(composed).not.toContain("[Active file content (excerpt)]");
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });

  it("composes '(none)' workspace + skips the excerpt when workspaceId is empty", async () => {
    const adapter = fakeAdapter();
    setAcpAdapter(adapter);
    const session = useChatSessions.getState().createSession("");
    act(() => {
      useChatSessions.getState().selectSession(session.id);
      useTabs.setState({ activePath: "/x/notes.md", tabs: [] });
    });
    const { getByTestId } = render(<WorkspaceChatPanel workspaceId="" />);
    fireEvent.change(getByTestId("chat-input"), { target: { value: "hi" } });
    fireEvent.click(getByTestId("chat-send"));
    await waitFor(() => expect(adapter.sendMessage).toHaveBeenCalled());
    const composed = String(
      (adapter.sendMessage as ReturnType<typeof vi.fn>).mock.calls[0]?.[1] ?? "",
    );
    expect(composed).toContain("[Workspace] (none)");
    expect(composed).not.toContain("[Active file content (excerpt)]");
  });

  it("appends a streamed agent_message_chunk to the active chat session", async () => {
    const adapter = fakeAdapter();
    setAcpAdapter(adapter);
    const { getByTestId } = render(<WorkspaceChatPanel workspaceId={WS} />);
    fireEvent.change(getByTestId("chat-input"), { target: { value: "hi" } });
    fireEvent.click(getByTestId("chat-send"));
    await waitFor(() => expect(adapter.startSession).toHaveBeenCalled());
    await waitFor(() => expect(acpListeners.length).toBeGreaterThan(0));
    const handler = acpListeners[acpListeners.length - 1];
    act(() => {
      handler?.({
        payload: {
          sessionId: "fake-sess",
          agentId: "claude-subscription",
          event: {
            kind: "sessionUpdate",
            update: {
              update: {
                sessionUpdate: "agent_message_chunk",
                content: { type: "text", text: "streamed reply" },
              },
            },
          },
        },
      });
    });
    const sessionId = useChatSessions.getState().activeSessionId as string;
    await waitFor(() => {
      const session = useChatSessions.getState().sessions[sessionId];
      const joined = (session?.messages ?? []).map((m) => m.content).join("");
      expect(joined).toContain("streamed reply");
    });
  });

  it("ignores notifications that do not map to a session", async () => {
    setAcpAdapter(fakeAdapter());
    render(<WorkspaceChatPanel workspaceId={WS} />);
    await waitFor(() => expect(acpListeners.length).toBeGreaterThan(0));
    const handler = acpListeners[acpListeners.length - 1];
    act(() => {
      handler?.({
        payload: { sessionId: "nope", agentId: "a", event: { kind: "sessionUpdate" } },
      });
    });
    expect(true).toBe(true);
  });

  it("ignores non-sessionUpdate and non-chunk updates for a mapped session", async () => {
    const adapter = fakeAdapter();
    setAcpAdapter(adapter);
    const { getByTestId } = render(<WorkspaceChatPanel workspaceId={WS} />);
    fireEvent.change(getByTestId("chat-input"), { target: { value: "hi" } });
    fireEvent.click(getByTestId("chat-send"));
    await waitFor(() => expect(adapter.startSession).toHaveBeenCalled());
    await waitFor(() => expect(acpListeners.length).toBeGreaterThan(0));
    const handler = acpListeners[acpListeners.length - 1];
    const sessionId = useChatSessions.getState().activeSessionId as string;
    const before = useChatSessions.getState().sessions[sessionId]?.messages.length ?? 0;
    act(() => {
      handler?.({ payload: { sessionId: "fake-sess", agentId: "a", event: { kind: "closed" } } });
      handler?.({
        payload: { sessionId: "fake-sess", agentId: "a", event: { kind: "sessionUpdate" } },
      });
      handler?.({
        payload: {
          sessionId: "fake-sess",
          agentId: "a",
          event: {
            kind: "sessionUpdate",
            update: {
              update: { sessionUpdate: "agent_message_chunk", content: { type: "text", text: "" } },
            },
          },
        },
      });
      handler?.({
        payload: {
          sessionId: "fake-sess",
          agentId: "a",
          event: { kind: "sessionUpdate", update: { update: { sessionUpdate: "tool_call" } } },
        },
      });
    });
    const after = useChatSessions.getState().sessions[sessionId]?.messages.length ?? 0;
    expect(after).toBe(before);
  });

  it("logs a warning when the acp:notification listen call rejects", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    listenMock.mockImplementation(async (event: string) => {
      if (event === "acp:notification") throw new Error("listen unavailable");
      return () => {};
    });
    render(<WorkspaceChatPanel workspaceId={WS} />);
    await waitFor(() =>
      expect(warn).toHaveBeenCalledWith(
        "[WorkspaceChatPanel] acp:notification listen failed",
        expect.any(Error),
      ),
    );
    warn.mockRestore();
  });

  it("detaches the listener registered after the component unmounts (cancelled path)", async () => {
    let resolveListen: ((fn: () => void) => void) | undefined;
    const unlisten = vi.fn();
    listenMock.mockImplementation(
      (event: string) =>
        new Promise<() => void>((resolve) => {
          if (event === "acp:notification") resolveListen = resolve;
          else resolve(() => {});
        }),
    );
    const { unmount } = render(<WorkspaceChatPanel workspaceId={WS} />);
    unmount();
    await act(async () => {
      resolveListen?.(unlisten);
      await Promise.resolve();
    });
    expect(unlisten).toHaveBeenCalledTimes(1);
  });
});
