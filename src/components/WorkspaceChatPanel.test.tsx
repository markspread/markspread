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

// saveTab (drag-edit accept write-back) pulls in the dialog plugin; jsdom
// has no Tauri backend, so stub the `ask` confirm.
vi.mock("@tauri-apps/plugin-dialog", () => ({
  ask: vi.fn(async () => true),
}));

import { invoke } from "@tauri-apps/api/core";
import { type AcpAdapter, resetAcpAdapter, setAcpAdapter } from "../lib/agents/acp-adapter";
import { useKeyStore } from "../lib/ai/key-store";
import { useActivityMode } from "../store/activity-mode";
import { useAgentRegistry } from "../store/agent-registry";
import { _cancelChatFlush, useChatSessions } from "../store/chat-sessions";
import { useDocCache } from "../store/doc-cache";
import { useDragChatSelection } from "../store/drag-chat-selection";
import { useTabs } from "../store/tabs";
import { useTelemetry } from "../store/telemetry";
import { useToolApprovalQueue } from "../store/tool-approval-queue";
import { WorkspaceChatPanel, permissionRequestToProposal } from "./WorkspaceChatPanel";

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
  useDragChatSelection.getState().clear();
  useDocCache.setState({ baselines: {}, live: {}, errors: {}, reloadEpoch: {} });
  useKeyStore.setState({ entries: [], defaultAlias: null });
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
  useDragChatSelection.getState().clear();
  useDocCache.setState({ baselines: {}, live: {}, errors: {}, reloadEpoch: {} });
  useKeyStore.setState({ entries: [], defaultAlias: null });
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

  // SC-LLM-05 (F12): the api-key lane never touches ACP. With no stored
  // credential it prints Settings guidance instead of silently failing.
  // The happy path (runner call + streaming) lives in
  // WorkspaceChatPanel.byok.test.tsx.
  it("api-key agent without a stored key prints Settings guidance (no ACP call)", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const adapter = fakeAdapter();
    setAcpAdapter(adapter);
    useAgentRegistry.getState().setWorkspaceDefault(WS, "claude-api-key");
    const { getByTestId, container } = render(<WorkspaceChatPanel workspaceId={WS} />);
    fireEvent.change(getByTestId("chat-input"), { target: { value: "yo" } });
    fireEvent.click(getByTestId("chat-send"));
    await waitFor(() => expect(container.textContent ?? "").toContain("No API key registered"));
    expect(container.textContent ?? "").toContain("Settings");
    expect(adapter.startSession).not.toHaveBeenCalled();
    warn.mockRestore();
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

  // NOTE(Fix-E/F14): `permissionRequest` is *not* in this "ignored" set any
  // more — it now routes into the tool-approval queue (see the dedicated
  // describe below). Only `closed` and non-chunk sessionUpdates are inert.
  it("ignores closed and non-chunk updates for a mapped session", async () => {
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

// ─── SC-CHAT-01/02 (F14): permissionRequest → approval card → decision ──

/** Establish the acp-session mapping by sending one message. */
async function bootMappedSession(getByTestId: (id: string) => HTMLElement, adapter: AcpAdapter) {
  fireEvent.change(getByTestId("chat-input"), { target: { value: "hello" } });
  fireEvent.click(getByTestId("chat-send"));
  await waitFor(() => expect(adapter.sendMessage).toHaveBeenCalled());
  await waitFor(() => expect(acpListeners.length).toBeGreaterThan(0));
  const handler = acpListeners[acpListeners.length - 1];
  if (!handler) throw new Error("acp listener not registered");
  return handler;
}

function permissionPayload(overrides: Record<string, unknown> = {}) {
  return {
    payload: {
      sessionId: "fake-sess",
      agentId: "claude-subscription",
      event: {
        kind: "permissionRequest",
        requestId: 7,
        params: { sessionId: "fake-sess", toolCallId: "tc-1", summary: "write notes.md" },
        ...overrides,
      },
    },
  };
}

describe("WorkspaceChatPanel — permission approval flow (SC-CHAT-01/02)", () => {
  beforeEach(resetStores);
  afterEach(() => {
    cleanup();
    resetStores();
  });

  it("event → enqueue → ToolDiffDialog card with the agent's summary", async () => {
    const adapter = fakeAdapter();
    setAcpAdapter(adapter);
    const { getByTestId } = render(<WorkspaceChatPanel workspaceId={WS} />);
    const handler = await bootMappedSession(getByTestId, adapter);

    act(() => handler(permissionPayload()));

    await waitFor(() => expect(useToolApprovalQueue.getState().queue).toHaveLength(1));
    expect(getByTestId("workspace-chat-tool-queue")).toBeTruthy();
    expect(getByTestId("tool-diff-dialog")).toBeTruthy();
    expect(getByTestId("tool-diff-summary").textContent).toContain("write notes.md");
    const q = useToolApprovalQueue.getState().queue[0];
    expect(q?.sessionId).toBe("fake-sess");
    expect(q?.requestId).toBe(7);
    expect(q?.toolCallId).toBe("tc-1");
  });

  it("Accept forwards `allow` to acp_approve_diff and drains the card", async () => {
    const adapter = fakeAdapter();
    setAcpAdapter(adapter);
    const { getByTestId, queryByTestId } = render(<WorkspaceChatPanel workspaceId={WS} />);
    const handler = await bootMappedSession(getByTestId, adapter);
    act(() => handler(permissionPayload()));
    await waitFor(() => expect(useToolApprovalQueue.getState().queue).toHaveLength(1));

    fireEvent.click(getByTestId("tool-diff-accept"));

    await waitFor(() =>
      expect(invokeMock).toHaveBeenCalledWith("acp_approve_diff", {
        sessionId: "fake-sess",
        requestId: { requestIdNumber: 7 },
        decision: "allow",
      }),
    );
    await waitFor(() => expect(useToolApprovalQueue.getState().queue).toHaveLength(0));
    expect(queryByTestId("tool-diff-dialog")).toBeNull();
  });

  it("Reject forwards `deny` to acp_approve_diff", async () => {
    const adapter = fakeAdapter();
    setAcpAdapter(adapter);
    const { getByTestId } = render(<WorkspaceChatPanel workspaceId={WS} />);
    const handler = await bootMappedSession(getByTestId, adapter);
    act(() => handler(permissionPayload()));
    await waitFor(() => expect(useToolApprovalQueue.getState().queue).toHaveLength(1));

    fireEvent.click(getByTestId("tool-diff-reject"));

    await waitFor(() =>
      expect(invokeMock).toHaveBeenCalledWith(
        "acp_approve_diff",
        expect.objectContaining({ decision: "deny" }),
      ),
    );
    expect(useToolApprovalQueue.getState().queue).toHaveLength(0);
  });

  it("a session with approve-all armed auto-allows without a card", async () => {
    const adapter = fakeAdapter();
    setAcpAdapter(adapter);
    const { getByTestId } = render(<WorkspaceChatPanel workspaceId={WS} />);
    const handler = await bootMappedSession(getByTestId, adapter);
    useToolApprovalQueue.getState().setApproveAll("fake-sess", true);

    act(() => handler(permissionPayload()));

    await waitFor(() =>
      expect(invokeMock).toHaveBeenCalledWith(
        "acp_approve_diff",
        expect.objectContaining({ decision: "allow" }),
      ),
    );
    expect(useToolApprovalQueue.getState().queue).toHaveLength(0);
  });

  it("ignores a permissionRequest for a session this panel does not own", async () => {
    const adapter = fakeAdapter();
    setAcpAdapter(adapter);
    const { getByTestId } = render(<WorkspaceChatPanel workspaceId={WS} />);
    const handler = await bootMappedSession(getByTestId, adapter);

    act(() =>
      handler({
        payload: {
          sessionId: "someone-elses-session",
          agentId: "claude-subscription",
          event: { kind: "permissionRequest", requestId: 9, params: {} },
        },
      }),
    );
    expect(useToolApprovalQueue.getState().queue).toHaveLength(0);
  });

  it("permissionRequestToProposal drops events without a requestId", () => {
    expect(
      permissionRequestToProposal({
        sessionId: "s",
        agentId: "a",
        event: { kind: "permissionRequest", params: {} },
      }),
    ).toBeNull();
  });

  it("permissionRequestToProposal extracts a rich embedded diff when present", () => {
    const p = permissionRequestToProposal({
      sessionId: "s",
      agentId: "a",
      event: {
        kind: "permissionRequest",
        requestId: "rid-1",
        params: {
          toolCall: {
            toolCallId: "tc-9",
            title: "Edit notes.md",
            kind: "edit",
            content: [{ type: "diff", path: "/ws/notes.md", oldText: "old", newText: "new" }],
          },
        },
      },
    });
    expect(p).not.toBeNull();
    expect(p?.tool).toBe("edit_file");
    expect(p?.filePath).toBe("/ws/notes.md");
    expect(p?.before).toBe("old");
    expect(p?.after).toBe("new");
    expect(p?.summary).toBe("Edit notes.md");
    expect(p?.toolCallId).toBe("tc-9");
  });
});

// ─── SC-DRAG-01..04 (F2): drag selection → chat → inline diff ───────────

const DOC = "# Title\nold line\nrest";
const SEL_FROM = 8; // "old line"
const SEL_TO = 16;

function captureSelection() {
  act(() => {
    useDragChatSelection.getState().capture({
      filePath: "notes.md",
      fullText: DOC,
      fromOffset: SEL_FROM,
      toOffset: SEL_TO,
    });
  });
}

/**
 * Adapter whose sendMessage streams `replies[n]` (n = call index) back
 * through the acp:notification listener before resolving — the same
 * ordering the Rust bridge produces (chunks precede prompt completion).
 */
function streamingAdapter(replies: string[]): AcpAdapter {
  let call = 0;
  return fakeAdapter({
    sendMessage: vi.fn(async () => {
      const text = replies[Math.min(call, replies.length - 1)] ?? "";
      call += 1;
      const handler = acpListeners[acpListeners.length - 1];
      if (text) {
        handler?.({
          payload: {
            sessionId: "fake-sess",
            agentId: "claude-subscription",
            event: {
              kind: "sessionUpdate",
              update: {
                update: { sessionUpdate: "agent_message_chunk", content: { type: "text", text } },
              },
            },
          },
        });
      }
    }),
  });
}

async function sendDragRequest(getByTestId: (id: string) => HTMLElement, text: string) {
  fireEvent.change(getByTestId("chat-input"), { target: { value: text } });
  fireEvent.click(getByTestId("chat-send"));
}

describe("WorkspaceChatPanel — drag-chat edit (SC-DRAG-01..04)", () => {
  beforeEach(resetStores);
  afterEach(() => {
    cleanup();
    resetStores();
  });

  it("SC-DRAG-01: a selected-region request renders an inline diff (green add / red remove)", async () => {
    const adapter = streamingAdapter(["new line"]);
    setAcpAdapter(adapter);
    const { getByTestId } = render(<WorkspaceChatPanel workspaceId={WS} />);
    captureSelection();
    expect(getByTestId("drag-chat-selection-chip").textContent).toContain("notes.md");

    await sendDragRequest(getByTestId, "make it better");

    await waitFor(() => expect(getByTestId("inline-diff-overlay")).toBeTruthy());
    const overlay = getByTestId("inline-diff-overlay");
    const adds = overlay.querySelectorAll('[data-chunk-kind="add"]');
    const removes = overlay.querySelectorAll('[data-chunk-kind="remove"]');
    expect(adds.length).toBeGreaterThan(0);
    expect(removes.length).toBeGreaterThan(0);
    expect(overlay.textContent).toContain("new line");
    expect(overlay.textContent).toContain("old line");
    // The composed request is selection-scoped, not the generic chat prompt.
    const composed = String(
      (adapter.sendMessage as ReturnType<typeof vi.fn>).mock.calls[0]?.[1] ?? "",
    );
    expect(composed).toContain("[Markspread drag-edit request]");
    expect(composed).toContain("old line");
    expect(composed).toContain("make it better");
  });

  it("SC-DRAG-02: Enter accepts — the document and the file get the new text", async () => {
    setAcpAdapter(streamingAdapter(["new line"]));
    const { getByTestId, queryByTestId } = render(<WorkspaceChatPanel workspaceId={WS} />);
    captureSelection();
    await sendDragRequest(getByTestId, "improve");
    await waitFor(() => expect(getByTestId("inline-diff-overlay")).toBeTruthy());

    fireEvent.keyDown(window, { key: "Enter" });

    const expected = "# Title\nnew line\nrest";
    // 에디터 반영 (doc-cache live) + 디스크 반영 (fs_write).
    await waitFor(() =>
      expect(invokeMock).toHaveBeenCalledWith("fs_write", {
        workspace: WS,
        path: "notes.md",
        content: expected,
      }),
    );
    expect(useDocCache.getState().getLive(WS, "notes.md")).toBe(expected);
    await waitFor(() => expect(queryByTestId("inline-diff-overlay")).toBeNull());
    // 선택은 소비됨 — chip 도 사라진다.
    expect(useDragChatSelection.getState().current).toBeNull();
    expect(queryByTestId("drag-chat-selection-chip")).toBeNull();
  });

  it("SC-DRAG-03: Esc rejects — document stays untouched", async () => {
    setAcpAdapter(streamingAdapter(["new line"]));
    const { getByTestId, queryByTestId } = render(<WorkspaceChatPanel workspaceId={WS} />);
    captureSelection();
    await sendDragRequest(getByTestId, "improve");
    await waitFor(() => expect(getByTestId("inline-diff-overlay")).toBeTruthy());

    fireEvent.keyDown(window, { key: "Escape" });

    await waitFor(() => expect(queryByTestId("inline-diff-overlay")).toBeNull());
    expect(invokeMock).not.toHaveBeenCalledWith("fs_write", expect.anything());
    expect(useDocCache.getState().getLive(WS, "notes.md")).toBeUndefined();
    expect(useDragChatSelection.getState().current).toBeNull();
  });

  it("SC-DRAG-04: Cmd+R re-requests once and swaps in the new proposal; a second Cmd+R is inert", async () => {
    const adapter = streamingAdapter(["first fix", "second fix"]);
    setAcpAdapter(adapter);
    const { getByTestId } = render(<WorkspaceChatPanel workspaceId={WS} />);
    captureSelection();
    await sendDragRequest(getByTestId, "improve");
    await waitFor(() => expect(getByTestId("inline-diff-overlay")).toBeTruthy());
    expect(getByTestId("inline-diff-overlay").textContent).toContain("first fix");

    fireEvent.keyDown(window, { key: "r", metaKey: true });

    await waitFor(() =>
      expect(getByTestId("inline-diff-overlay").textContent).toContain("second fix"),
    );
    expect(adapter.sendMessage).toHaveBeenCalledTimes(2);
    const retryComposed = String(
      (adapter.sendMessage as ReturnType<typeof vi.fn>).mock.calls[1]?.[1] ?? "",
    );
    expect(retryComposed).toContain("[Retry]");

    // 재요청은 1회 — 추가 Cmd+R 은 요청을 만들지 않고 overlay 유지.
    fireEvent.keyDown(window, { key: "r", metaKey: true });
    await act(async () => {
      await Promise.resolve();
    });
    expect(adapter.sendMessage).toHaveBeenCalledTimes(2);
    expect(getByTestId("inline-diff-overlay").textContent).toContain("second fix");
  });

  it("clears the selection chip via its ✕ button (request then routes as normal chat)", async () => {
    const adapter = fakeAdapter();
    setAcpAdapter(adapter);
    const { getByTestId, queryByTestId } = render(<WorkspaceChatPanel workspaceId={WS} />);
    captureSelection();
    fireEvent.click(getByTestId("drag-chat-selection-clear"));
    expect(queryByTestId("drag-chat-selection-chip")).toBeNull();

    await sendDragRequest(getByTestId, "hello");
    await waitFor(() => expect(adapter.sendMessage).toHaveBeenCalled());
    const composed = String(
      (adapter.sendMessage as ReturnType<typeof vi.fn>).mock.calls[0]?.[1] ?? "",
    );
    expect(composed).not.toContain("[Markspread drag-edit request]");
    expect(composed).toContain("[User message]");
  });

  it("an empty agent reply aborts the flow with a system notice (document untouched)", async () => {
    setAcpAdapter(streamingAdapter([""]));
    const { getByTestId, queryByTestId, container } = render(
      <WorkspaceChatPanel workspaceId={WS} />,
    );
    captureSelection();
    await sendDragRequest(getByTestId, "improve");

    await waitFor(() => expect(container.textContent ?? "").toContain("no replacement text"));
    expect(queryByTestId("inline-diff-overlay")).toBeNull();
    expect(invokeMock).not.toHaveBeenCalledWith("fs_write", expect.anything());
  });

  it("adapter failure during a drag request surfaces as a system error message", async () => {
    const adapter = fakeAdapter({
      sendMessage: vi.fn(async () => {
        throw new Error("agent exploded");
      }),
    });
    setAcpAdapter(adapter);
    const { getByTestId, container } = render(<WorkspaceChatPanel workspaceId={WS} />);
    captureSelection();
    await sendDragRequest(getByTestId, "improve");
    await waitFor(() => expect(container.textContent ?? "").toContain("agent exploded"));
  });
});
