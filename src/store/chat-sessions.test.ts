// ADR-0010 D5 + telemetry: CRUD on chat sessions, persistence side-effect
// stubs, session_created/resumed events.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const invokeMock = vi.fn();
vi.mock("@tauri-apps/api/core", () => ({
  invoke: (...args: unknown[]) => invokeMock(...args),
}));

import { type ChatSession, _cancelChatFlush, useChatSessions } from "./chat-sessions";
import { subscribeTelemetry, useTelemetry } from "./telemetry";

function reset() {
  useChatSessions.getState()._reset();
  _cancelChatFlush();
  invokeMock.mockReset();
  invokeMock.mockResolvedValue(undefined);
}

describe("chat-sessions store", () => {
  beforeEach(() => {
    reset();
    useTelemetry.setState({ consent: "enabled" });
  });
  afterEach(() => {
    reset();
    useTelemetry.setState({ consent: "unset" });
  });

  it("createSession adds the session, activates it, emits session_created", async () => {
    const events: { type: string }[] = [];
    const off = subscribeTelemetry((e) => events.push(e));
    const s = useChatSessions.getState().createSession("ws1", "Hello");
    expect(s.title).toBe("Hello");
    expect(useChatSessions.getState().activeSessionId).toBe(s.id);
    expect(useChatSessions.getState().byWorkspace.ws1).toContain(s.id);
    expect(events.some((e) => e.type === "chat.session_created")).toBe(true);
    off();
  });

  it("uses the default title when none is supplied", () => {
    const s = useChatSessions.getState().createSession("ws1");
    expect(s.title).toBe("New chat");
  });

  it("selectSession switches active id and emits session_resumed", () => {
    const events: { type: string }[] = [];
    const off = subscribeTelemetry((e) => events.push(e));
    const s = useChatSessions.getState().createSession("ws1");
    events.length = 0;
    useChatSessions.getState().selectSession(s.id);
    expect(useChatSessions.getState().activeSessionId).toBe(s.id);
    expect(events.some((e) => e.type === "chat.session_resumed")).toBe(true);
    off();
  });

  it("selectSession is a no-op for unknown session ids", () => {
    useChatSessions.getState().selectSession("nope");
    expect(useChatSessions.getState().activeSessionId).toBeNull();
  });

  it("appendMessage tags the message + updates updatedAt", async () => {
    vi.useFakeTimers();
    try {
      const s = useChatSessions.getState().createSession("ws1");
      const m = useChatSessions.getState().appendMessage(s.id, {
        role: "user",
        content: "hi",
      });
      expect(m.id).toBeTruthy();
      expect(useChatSessions.getState().sessions[s.id]?.messages).toHaveLength(1);
      // Flush the debounce so persistence path runs.
      vi.advanceTimersByTime(200);
      await Promise.resolve();
      expect(invokeMock).toHaveBeenCalledWith("chat_session_save", expect.any(Object));
    } finally {
      vi.useRealTimers();
    }
  });

  it("appendMessage throws for unknown session ids", () => {
    expect(() =>
      useChatSessions.getState().appendMessage("missing", { role: "user", content: "x" }),
    ).toThrowError(/unknown session/);
  });

  it("appendAssistantChunk ignores empty chunks", () => {
    const s = useChatSessions.getState().createSession("ws1");
    useChatSessions.getState().appendAssistantChunk(s.id, "");
    expect(useChatSessions.getState().sessions[s.id]?.messages).toHaveLength(0);
  });

  it("appendAssistantChunk is a silent no-op for unknown session ids", () => {
    // session removed (user deleted) — drop silently, no throw.
    expect(() => useChatSessions.getState().appendAssistantChunk("missing", "hi")).not.toThrow();
  });

  it("appendAssistantChunk creates a new assistant message when none is trailing", () => {
    const s = useChatSessions.getState().createSession("ws1");
    useChatSessions.getState().appendMessage(s.id, { role: "user", content: "ask" });
    useChatSessions.getState().appendAssistantChunk(s.id, "Hel");
    const msgs = useChatSessions.getState().sessions[s.id]?.messages;
    expect(msgs).toHaveLength(2);
    expect(msgs?.[1]?.role).toBe("assistant");
    expect(msgs?.[1]?.content).toBe("Hel");
  });

  it("appendAssistantChunk appends to the trailing assistant message", () => {
    const s = useChatSessions.getState().createSession("ws1");
    useChatSessions.getState().appendAssistantChunk(s.id, "Hel");
    useChatSessions.getState().appendAssistantChunk(s.id, "lo");
    const msgs = useChatSessions.getState().sessions[s.id]?.messages;
    expect(msgs).toHaveLength(1);
    expect(msgs?.[0]?.role).toBe("assistant");
    expect(msgs?.[0]?.content).toBe("Hello");
  });

  it("appendAssistantChunk schedules a debounced flush", async () => {
    vi.useFakeTimers();
    try {
      const s = useChatSessions.getState().createSession("ws1");
      invokeMock.mockClear();
      useChatSessions.getState().appendAssistantChunk(s.id, "chunk");
      vi.advanceTimersByTime(200);
      await Promise.resolve();
      expect(invokeMock).toHaveBeenCalledWith("chat_session_save", expect.any(Object));
    } finally {
      vi.useRealTimers();
    }
  });

  it("renameSession updates title + is a no-op for unknown ids", () => {
    const s = useChatSessions.getState().createSession("ws1");
    useChatSessions.getState().renameSession(s.id, "Renamed");
    expect(useChatSessions.getState().sessions[s.id]?.title).toBe("Renamed");
    useChatSessions.getState().renameSession("nope", "x");
    expect(useChatSessions.getState().sessions.nope).toBeUndefined();
  });

  it("deleteSession removes the entry + clears activeSessionId + invokes IPC delete", () => {
    const s = useChatSessions.getState().createSession("ws1");
    useChatSessions.getState().deleteSession(s.id);
    expect(useChatSessions.getState().sessions[s.id]).toBeUndefined();
    expect(useChatSessions.getState().activeSessionId).toBeNull();
    expect(useChatSessions.getState().byWorkspace.ws1).not.toContain(s.id);
    expect(invokeMock).toHaveBeenCalledWith("chat_session_delete", { sessionId: s.id });
  });

  it("deleteSession tolerates a session missing from the byWorkspace index", () => {
    const s = useChatSessions.getState().createSession("ws1");
    // Simulate an index desync: session present, but no byWorkspace entry for
    // its workspace → delete must fall back to an empty list (?? []).
    useChatSessions.setState({ byWorkspace: {} });
    expect(() => useChatSessions.getState().deleteSession(s.id)).not.toThrow();
    expect(useChatSessions.getState().sessions[s.id]).toBeUndefined();
    expect(useChatSessions.getState().byWorkspace.ws1).toEqual([]);
  });

  it("deleteSession is a no-op for unknown ids", () => {
    useChatSessions.getState().deleteSession("nope");
    expect(useChatSessions.getState().sessions).toEqual({});
  });

  it("deleteSession cancels a pending flush", () => {
    vi.useFakeTimers();
    try {
      const s = useChatSessions.getState().createSession("ws1");
      // The createSession schedules a flush; delete before it fires.
      useChatSessions.getState().deleteSession(s.id);
      // Advancing past the debounce should not trigger another save —
      // the timer was cleared.
      invokeMock.mockClear();
      vi.advanceTimersByTime(500);
      expect(invokeMock.mock.calls.find((c) => c[0] === "chat_session_save")).toBeUndefined();
    } finally {
      vi.useRealTimers();
    }
  });

  it("deleteSession keeps a different active session intact", () => {
    const a = useChatSessions.getState().createSession("ws1");
    const b = useChatSessions.getState().createSession("ws1");
    useChatSessions.getState().selectSession(a.id);
    useChatSessions.getState().deleteSession(b.id);
    expect(useChatSessions.getState().activeSessionId).toBe(a.id);
  });

  it("loadWorkspaceSessions hydrates the store from IPC", async () => {
    const session: ChatSession = {
      id: "s1",
      workspaceId: "ws1",
      title: "Loaded",
      createdAt: 1,
      updatedAt: 2,
      messages: [],
    };
    invokeMock.mockResolvedValueOnce([session]);
    await useChatSessions.getState().loadWorkspaceSessions("ws1");
    expect(useChatSessions.getState().sessions.s1?.title).toBe("Loaded");
    expect(useChatSessions.getState().byWorkspace.ws1).toEqual(["s1"]);
  });

  it("loadWorkspaceSessions ignores empty / non-array responses", async () => {
    invokeMock.mockResolvedValueOnce([]);
    await useChatSessions.getState().loadWorkspaceSessions("ws1");
    expect(useChatSessions.getState().byWorkspace.ws1).toBeUndefined();
    invokeMock.mockResolvedValueOnce("not-an-array");
    await useChatSessions.getState().loadWorkspaceSessions("ws1");
    expect(useChatSessions.getState().byWorkspace.ws1).toBeUndefined();
  });

  it("loadWorkspaceSessions swallows IPC errors", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    invokeMock.mockRejectedValueOnce(new Error("boom"));
    await expect(useChatSessions.getState().loadWorkspaceSessions("ws1")).resolves.toBeUndefined();
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });

  it("save errors fall back to a warn without throwing", async () => {
    vi.useFakeTimers();
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    try {
      invokeMock.mockReset();
      invokeMock.mockRejectedValue(new Error("disk full"));
      const s = useChatSessions.getState().createSession("ws1");
      useChatSessions.getState().appendMessage(s.id, { role: "user", content: "hi" });
      vi.advanceTimersByTime(200);
      await Promise.resolve();
      await Promise.resolve();
      expect(warn).toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
      warn.mockRestore();
    }
  });
});
