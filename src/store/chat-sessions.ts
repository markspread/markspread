// ADR-0010 D2/D5: per-workspace chat session store.
//
// Each session is a list of messages keyed by `sessionId`. Persistence
// lives under `.markspread/chats/<sessionId>.json` (one file per
// session), loaded lazily on workspace mount and flushed on append
// through a debounced writer. The store is intentionally tiny — LLM
// wiring happens in U2 and reads/writes through `appendMessage`.

import { invoke } from "@tauri-apps/api/core";
import { create } from "zustand";
import { emitTelemetry } from "./telemetry";

export type ChatRole = "user" | "assistant" | "system";

export interface ChatMessage {
  id: string;
  role: ChatRole;
  content: string;
  createdAt: number;
}

export interface ChatSession {
  id: string;
  workspaceId: string;
  title: string;
  createdAt: number;
  updatedAt: number;
  messages: ChatMessage[];
}

interface ChatSessionsState {
  /** workspaceId → ordered list of session ids (newest first). */
  byWorkspace: Record<string, string[]>;
  sessions: Record<string, ChatSession>;
  activeSessionId: string | null;
  /** Test helper: clear in-memory state (does not touch disk). */
  _reset: () => void;
  createSession: (workspaceId: string, title?: string) => ChatSession;
  selectSession: (id: string) => void;
  appendMessage: (sessionId: string, msg: Omit<ChatMessage, "id" | "createdAt">) => ChatMessage;
  /**
   * 마지막 assistant 메시지에 chunk 누적. ACP `agent_message_chunk` notification
   * 처리용. 마지막 메시지가 assistant 가 아니거나 finalized 되었으면 새 assistant
   * 메시지를 만들고 그 위에 누적.
   */
  appendAssistantChunk: (sessionId: string, chunk: string) => void;
  renameSession: (id: string, title: string) => void;
  deleteSession: (id: string) => void;
  /** Load every session under the given workspace from disk. Idempotent. */
  loadWorkspaceSessions: (workspaceId: string) => Promise<void>;
}

function randomId(): string {
  return globalThis.crypto.randomUUID().slice(0, 12);
}

function defaultTitle(): string {
  return "New chat";
}

const flushTimers = new Map<string, ReturnType<typeof setTimeout>>();

async function flushSession(session: ChatSession): Promise<void> {
  try {
    await invoke("chat_session_save", { session });
  } catch (e) {
    // The Tauri handler may not be wired yet. We swallow so the chat
    // remains usable in-memory; the next launch will see no history,
    // which is acceptable for U1.
    console.warn("[chat-sessions] save failed", e);
  }
}

function scheduleFlush(sessionId: string, getSession: () => ChatSession | undefined): void {
  const existing = flushTimers.get(sessionId);
  if (existing) clearTimeout(existing);
  const timer = setTimeout(() => {
    flushTimers.delete(sessionId);
    const s = getSession();
    if (s) void flushSession(s);
  }, 150);
  flushTimers.set(sessionId, timer);
}

/** Test-only: cancel every pending flush + clear the timer map. */
export function _cancelChatFlush(): void {
  for (const t of flushTimers.values()) clearTimeout(t);
  flushTimers.clear();
}

export const useChatSessions = create<ChatSessionsState>((set, get) => ({
  byWorkspace: {},
  sessions: {},
  activeSessionId: null,
  _reset: () => set({ byWorkspace: {}, sessions: {}, activeSessionId: null }),
  createSession: (workspaceId, title) => {
    const now = Date.now();
    const session: ChatSession = {
      id: randomId(),
      workspaceId,
      title: title ?? defaultTitle(),
      createdAt: now,
      updatedAt: now,
      messages: [],
    };
    set((s) => ({
      sessions: { ...s.sessions, [session.id]: session },
      byWorkspace: {
        ...s.byWorkspace,
        [workspaceId]: [session.id, ...(s.byWorkspace[workspaceId] ?? [])],
      },
      activeSessionId: session.id,
    }));
    emitTelemetry({ type: "chat.session_created", workspaceId, messageCount: 0 });
    scheduleFlush(session.id, () => get().sessions[session.id]);
    return session;
  },
  selectSession: (id) => {
    const s = get().sessions[id];
    if (!s) return;
    set({ activeSessionId: id });
    emitTelemetry({
      type: "chat.session_resumed",
      workspaceId: s.workspaceId,
      messageCount: s.messages.length,
    });
  },
  appendMessage: (sessionId, msg) => {
    const s = get().sessions[sessionId];
    if (!s) {
      throw new Error(`chat-sessions: unknown session ${sessionId}`);
    }
    const full: ChatMessage = { id: randomId(), createdAt: Date.now(), ...msg };
    const updated: ChatSession = {
      ...s,
      messages: [...s.messages, full],
      updatedAt: full.createdAt,
    };
    set((state) => ({ sessions: { ...state.sessions, [sessionId]: updated } }));
    scheduleFlush(sessionId, () => get().sessions[sessionId]);
    return full;
  },
  appendAssistantChunk: (sessionId, chunk) => {
    if (!chunk) return;
    const s = get().sessions[sessionId];
    if (!s) {
      // session 이 사라진 경우 (user 가 삭제). silent drop.
      return;
    }
    const now = Date.now();
    const lastIdx = s.messages.length - 1;
    const last = s.messages[lastIdx];
    let nextMessages: ChatMessage[];
    if (last && last.role === "assistant") {
      const merged: ChatMessage = { ...last, content: last.content + chunk };
      nextMessages = [...s.messages.slice(0, lastIdx), merged];
    } else {
      const created: ChatMessage = {
        id: randomId(),
        role: "assistant",
        content: chunk,
        createdAt: now,
      };
      nextMessages = [...s.messages, created];
    }
    const updated: ChatSession = { ...s, messages: nextMessages, updatedAt: now };
    set((state) => ({ sessions: { ...state.sessions, [sessionId]: updated } }));
    scheduleFlush(sessionId, () => get().sessions[sessionId]);
  },
  renameSession: (id, title) => {
    const s = get().sessions[id];
    if (!s) return;
    const updated: ChatSession = { ...s, title, updatedAt: Date.now() };
    set((state) => ({ sessions: { ...state.sessions, [id]: updated } }));
    scheduleFlush(id, () => get().sessions[id]);
  },
  deleteSession: (id) => {
    const s = get().sessions[id];
    if (!s) return;
    set((state) => {
      const nextSessions = { ...state.sessions };
      delete nextSessions[id];
      const list = state.byWorkspace[s.workspaceId] ?? [];
      const nextList = list.filter((sid) => sid !== id);
      const nextByWs = { ...state.byWorkspace, [s.workspaceId]: nextList };
      const nextActive = state.activeSessionId === id ? null : state.activeSessionId;
      return { sessions: nextSessions, byWorkspace: nextByWs, activeSessionId: nextActive };
    });
    const existing = flushTimers.get(id);
    if (existing) {
      clearTimeout(existing);
      flushTimers.delete(id);
    }
    void invoke("chat_session_delete", { sessionId: id }).catch(() => {});
  },
  loadWorkspaceSessions: async (workspaceId) => {
    try {
      const loaded = await invoke<ChatSession[]>("chat_session_list", { workspaceId });
      if (!Array.isArray(loaded) || loaded.length === 0) return;
      set((state) => {
        const nextSessions = { ...state.sessions };
        for (const s of loaded) nextSessions[s.id] = s;
        const ids = loaded
          .slice()
          .sort((a, b) => b.updatedAt - a.updatedAt)
          .map((s) => s.id);
        return {
          sessions: nextSessions,
          byWorkspace: { ...state.byWorkspace, [workspaceId]: ids },
        };
      });
    } catch (e) {
      console.warn("[chat-sessions] load failed", e);
    }
  },
}));
