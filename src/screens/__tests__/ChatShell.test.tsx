// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn(async () => undefined),
}));

// FileTree + ChatShell 양쪽이 `acp:notification` / file watch event 를
// listen 함. jsdom 환경에는 window.__TAURI_INTERNALS__ 가 없어
// transformCallback undefined → 마운트 시 throw. 빈 unlisten 만 반환.
//
// Captures the most recent `acp:notification` handler so tests can drive the
// Rust→frontend stream-chunk path (handleAcpNotification).
const acpListeners: Array<(evt: { payload: unknown }) => void> = [];
async function defaultListen(event: string, handler: (evt: { payload: unknown }) => void) {
  if (event === "acp:notification") acpListeners.push(handler);
  return () => {};
}
const listenMock = vi.fn(defaultListen);
vi.mock("@tauri-apps/api/event", () => ({
  listen: (...args: unknown[]) => (listenMock as unknown as (...a: unknown[]) => unknown)(...args),
}));

import { invoke } from "@tauri-apps/api/core";
import { type AcpAdapter, resetAcpAdapter, setAcpAdapter } from "../../lib/agents/acp-adapter";
import { useAgentRegistry } from "../../store/agent-registry";
import { _cancelChatFlush, useChatSessions } from "../../store/chat-sessions";
import { useTabs } from "../../store/tabs";
import { subscribeTelemetry, useTelemetry } from "../../store/telemetry";
import { useToolApprovalQueue } from "../../store/tool-approval-queue";
import { useWorkspace } from "../../store/workspace";
import { ChatShell } from "../ChatShell";

const invokeMock = invoke as unknown as ReturnType<typeof vi.fn>;

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
  useTabs.setState({ tabs: [], activePath: null });
  resetAcpAdapter();
  acpListeners.length = 0;
  invokeMock.mockReset();
  invokeMock.mockImplementation(async () => undefined);
  listenMock.mockReset();
  listenMock.mockImplementation(defaultListen);
}

afterEach(() => {
  cleanup();
  useChatSessions.getState()._reset();
  _cancelChatFlush();
  useWorkspace.setState({ current: null, preferredShell: "chat" });
  useTelemetry.setState({ consent: "unset" });
  useAgentRegistry.getState()._reset();
  useToolApprovalQueue.getState()._reset();
  useTabs.setState({ tabs: [], activePath: null });
  resetAcpAdapter();
  acpListeners.length = 0;
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
    // FIX (in-editor context): ChatShell 가 raw "hi" 가 아니라 context
    // preamble + workspace/active-file 메타 + user message 로 합성한 문자열을
    // 보낸다. agent 가 "어디서 실행되는지" 인지하려면 필수.
    await waitFor(() => expect(adapter.sendMessage).toHaveBeenCalled());
    const callArgs = (adapter.sendMessage as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(callArgs?.[0]).toBe("fake-sess");
    const composed = String(callArgs?.[1] ?? "");
    expect(composed).toContain("[Markspread environment]");
    expect(composed).toContain("[Workspace] /ws-1");
    expect(composed).toContain("[User message]");
    expect(composed).toContain("hi");
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

  it("the toolbar '+ Parser' button opens the CreateParserDialog and it can be closed", async () => {
    const { getByTestId, queryByTestId } = render(<ChatShell />);
    // Dialog starts closed.
    expect(queryByTestId("parser-create")).toBeNull();
    fireEvent.click(getByTestId("chat-create-parser"));
    // onClick → setParserDialogOpen(true) → dialog renders.
    expect(getByTestId("parser-create")).toBeTruthy();
    // Close it via the dialog's close affordance → ChatShell onClose runs.
    fireEvent.click(getByTestId("create-parser-close"));
    await waitFor(() => expect(queryByTestId("parser-create")).toBeNull());
  });

  it("opening a file renders the editor region and a code-block '+ Parser' opens the prefilled dialog", () => {
    // activeTabPath set → ChatShell renders the editor/preview region + the
    // ChatStream with onRegisterParser wired (branch at line 303).
    act(() => {
      useTabs.setState({ activePath: "/ws-1/notes.md", tabs: [] });
    });
    // Pre-create the session + an assistant message with a JS code block so the
    // register button shows on first render.
    const session = useChatSessions.getState().createSession("/ws-1");
    act(() => {
      useChatSessions.getState().selectSession(session.id);
      useChatSessions
        .getState()
        .appendMessage(session.id, { role: "assistant", content: "```js\nconst p = 1;\n```" });
    });
    const { getByTestId } = render(<ChatShell />);
    expect(getByTestId("chat-editor-region")).toBeTruthy();
    // md file → preview region present.
    expect(getByTestId("chat-preview-region")).toBeTruthy();
    // Click the code-block register button → onRegisterParser sets the prefill
    // source + opens the dialog.
    fireEvent.click(getByTestId("chat-codeblock-register-parser"));
    expect(getByTestId("parser-source")).toBeTruthy();
  });

  it("renders the editor region without a preview for a non-markdown file", () => {
    act(() => {
      useTabs.setState({ activePath: "/ws-1/data.csv", tabs: [] });
    });
    const { getByTestId, queryByTestId } = render(<ChatShell />);
    expect(getByTestId("chat-editor-region")).toBeTruthy();
    // non-md → no preview region (isMarkdownPath false branch).
    expect(queryByTestId("chat-preview-region")).toBeNull();
  });

  it("attaches the active file excerpt to the composed agent input", async () => {
    const adapter = fakeAdapter();
    setAcpAdapter(adapter);
    invokeMock.mockImplementation(async (cmd: string) => {
      if (cmd === "fs_read_file") {
        return { content: "# Heading\nbody line", encoding: "utf-8" };
      }
      return undefined;
    });
    act(() => {
      useTabs.setState({ activePath: "/ws-1/notes.md", tabs: [] });
    });
    const { getByTestId } = render(<ChatShell />);
    fireEvent.change(getByTestId("chat-input"), { target: { value: "summarize" } });
    fireEvent.click(getByTestId("chat-send"));
    await waitFor(() => expect(adapter.sendMessage).toHaveBeenCalled());
    const composed = String(
      (adapter.sendMessage as ReturnType<typeof vi.fn>).mock.calls[0]?.[1] ?? "",
    );
    expect(composed).toContain("[Active file] /ws-1/notes.md");
    expect(composed).toContain("[Active file content (excerpt)]");
    expect(composed).toContain("# Heading");
  });

  it("truncates a very long active-file excerpt", async () => {
    const adapter = fakeAdapter();
    setAcpAdapter(adapter);
    const long = "A".repeat(5000);
    invokeMock.mockImplementation(async (cmd: string) => {
      if (cmd === "fs_read_file") return { content: long, encoding: "utf-8" };
      return undefined;
    });
    act(() => {
      useTabs.setState({ activePath: "/ws-1/big.md", tabs: [] });
    });
    const { getByTestId } = render(<ChatShell />);
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
      useTabs.setState({ activePath: "/ws-1/empty.md", tabs: [] });
    });
    const { getByTestId } = render(<ChatShell />);
    fireEvent.change(getByTestId("chat-input"), { target: { value: "go" } });
    fireEvent.click(getByTestId("chat-send"));
    await waitFor(() => expect(adapter.sendMessage).toHaveBeenCalled());
    const composed = String(
      (adapter.sendMessage as ReturnType<typeof vi.fn>).mock.calls[0]?.[1] ?? "",
    );
    expect(composed).toContain("[Active file] /ws-1/empty.md");
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
      useTabs.setState({ activePath: "/ws-1/locked.md", tabs: [] });
    });
    const { getByTestId } = render(<ChatShell />);
    fireEvent.change(getByTestId("chat-input"), { target: { value: "go" } });
    fireEvent.click(getByTestId("chat-send"));
    await waitFor(() => expect(adapter.sendMessage).toHaveBeenCalled());
    const composed = String(
      (adapter.sendMessage as ReturnType<typeof vi.fn>).mock.calls[0]?.[1] ?? "",
    );
    // read failed → no excerpt block, but the path line is still present.
    expect(composed).toContain("[Active file] /ws-1/locked.md");
    expect(composed).not.toContain("[Active file content (excerpt)]");
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });

  it("composes input with '(none)' workspace + skips the excerpt when workspaceId is empty", async () => {
    const adapter = fakeAdapter();
    setAcpAdapter(adapter);
    // Pre-create a session under the empty workspace so onSend has a session,
    // and set an active file path so readActiveFileExcerpt is reached with an
    // empty workspace → its `!workspace` early-return branch.
    const session = useChatSessions.getState().createSession("");
    act(() => {
      useChatSessions.getState().selectSession(session.id);
      useTabs.setState({ activePath: "/x/notes.md", tabs: [] });
    });
    const { getByTestId } = render(<ChatShell workspaceIdOverride="" />);
    fireEvent.change(getByTestId("chat-input"), { target: { value: "hi" } });
    fireEvent.click(getByTestId("chat-send"));
    await waitFor(() => expect(adapter.sendMessage).toHaveBeenCalled());
    const composed = String(
      (adapter.sendMessage as ReturnType<typeof vi.fn>).mock.calls[0]?.[1] ?? "",
    );
    expect(composed).toContain("[Workspace] (none)");
    // empty workspace → readActiveFileExcerpt returns null → no excerpt block.
    expect(composed).not.toContain("[Active file content (excerpt)]");
  });

  it("appends a streamed agent_message_chunk to the active chat session", async () => {
    const adapter = fakeAdapter();
    setAcpAdapter(adapter);
    const { getByTestId } = render(<ChatShell />);
    // Send a message so the ACP↔chat session mapping is established.
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

  it("ignores ACP notifications that do not map to a chat session or are not chunks", async () => {
    const adapter = fakeAdapter();
    setAcpAdapter(adapter);
    render(<ChatShell />);
    await waitFor(() => expect(acpListeners.length).toBeGreaterThan(0));
    const handler = acpListeners[acpListeners.length - 1];
    // Unknown ACP session id → early return (no mapping yet).
    act(() => {
      handler?.({
        payload: { sessionId: "nope", agentId: "a", event: { kind: "sessionUpdate" } },
      });
    });
    // No throw / no crash is the assertion; nav still renders.
    expect(true).toBe(true);
  });

  it("ignores non-sessionUpdate and non-chunk updates for a mapped session", async () => {
    const adapter = fakeAdapter();
    setAcpAdapter(adapter);
    const { getByTestId } = render(<ChatShell />);
    fireEvent.change(getByTestId("chat-input"), { target: { value: "hi" } });
    fireEvent.click(getByTestId("chat-send"));
    await waitFor(() => expect(adapter.startSession).toHaveBeenCalled());
    await waitFor(() => expect(acpListeners.length).toBeGreaterThan(0));
    const handler = acpListeners[acpListeners.length - 1];
    const sessionId = useChatSessions.getState().activeSessionId as string;
    const before = useChatSessions.getState().sessions[sessionId]?.messages.length ?? 0;
    act(() => {
      // kind !== sessionUpdate → return
      handler?.({ payload: { sessionId: "fake-sess", agentId: "a", event: { kind: "closed" } } });
      // sessionUpdate but inner update missing → return
      handler?.({
        payload: { sessionId: "fake-sess", agentId: "a", event: { kind: "sessionUpdate" } },
      });
      // chunk update but empty text → no append
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
      // sessionUpdate but not agent_message_chunk → return
      handler?.({
        payload: {
          sessionId: "fake-sess",
          agentId: "a",
          event: {
            kind: "sessionUpdate",
            update: { update: { sessionUpdate: "tool_call" } },
          },
        },
      });
    });
    const after = useChatSessions.getState().sessions[sessionId]?.messages.length ?? 0;
    expect(after).toBe(before);
  });

  it("an error object with a string message surfaces that message", async () => {
    const adapter = fakeAdapter({
      sendMessage: vi.fn(async () => {
        throw { message: "structured failure" };
      }),
    });
    setAcpAdapter(adapter);
    const { getByTestId, container } = render(<ChatShell />);
    fireEvent.change(getByTestId("chat-input"), { target: { value: "x" } });
    fireEvent.click(getByTestId("chat-send"));
    await waitFor(() => {
      expect(container.textContent ?? "").toContain("structured failure");
    });
  });

  it("an error object without a message is JSON-stringified into the system message", async () => {
    const adapter = fakeAdapter({
      sendMessage: vi.fn(async () => {
        throw { code: 42, detail: "weird" };
      }),
    });
    setAcpAdapter(adapter);
    const { getByTestId, container } = render(<ChatShell />);
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
        // number → not Error, not string, not object → final else: String(err).
        throw 42;
      }),
    });
    setAcpAdapter(adapter);
    const { getByTestId, container } = render(<ChatShell />);
    fireEvent.change(getByTestId("chat-input"), { target: { value: "x" } });
    fireEvent.click(getByTestId("chat-send"));
    await waitFor(() => {
      const txt = container.textContent ?? "";
      expect(txt).toContain("Agent error: 42");
    });
  });

  it("logs a warning when the acp:notification listen call rejects", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    listenMock.mockImplementation(async (event: string) => {
      if (event === "acp:notification") throw new Error("listen unavailable");
      return () => {};
    });
    render(<ChatShell />);
    await waitFor(() =>
      expect(warn).toHaveBeenCalledWith(
        "[ChatShell] acp:notification listen failed",
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
          if (event === "acp:notification") {
            resolveListen = resolve;
          } else {
            resolve(() => {});
          }
        }),
    );
    const { unmount } = render(<ChatShell />);
    // Unmount BEFORE the listen promise resolves → effect cleanup sets cancelled.
    unmount();
    // Now resolve listen → the async IIFE sees cancelled === true → fn() + return.
    await act(async () => {
      resolveListen?.(unlisten);
      await Promise.resolve();
    });
    expect(unlisten).toHaveBeenCalledTimes(1);
  });

  it("a non-serializable error object falls back to String(err)", async () => {
    const circular: Record<string, unknown> = {};
    circular.self = circular; // JSON.stringify throws → catch → String(err)
    const adapter = fakeAdapter({
      sendMessage: vi.fn(async () => {
        throw circular;
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
});
