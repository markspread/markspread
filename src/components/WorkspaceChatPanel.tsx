// ADR-0019 §Decision.1: the Workspace shell's Chat is a *toggle panel*,
// not a separate shell. This component owns the agent wiring that used
// to live in the now-deleted `ChatShell`:
//   - session bootstrap (always one session per workspace),
//   - the `acp:notification` stream listener,
//   - `onSend` → ACP adapter with a context-aware composed prompt,
//   - the queued tool-diff cards,
//   - the `+ Parser` entry (mode switch, never a modal — N5),
//   - code-block "파서로 만들기" → enterParser({prefillSource}).
//
// It is intentionally surface-agnostic: WorkspaceShell mounts it at the
// bottom of the document column, and it reads the active file from
// `useTabs` so the agent always knows which document the user is on.

import { invoke } from "@tauri-apps/api/core";
import { type UnlistenFn, listen } from "@tauri-apps/api/event";
import { useEffect, useMemo, useRef } from "react";
import { getAcpAdapter } from "../lib/agents/acp-adapter";
import { ChatStream } from "../screens/chat/ChatStream";
import { useActivityMode } from "../store/activity-mode";
import { useAgentRegistry } from "../store/agent-registry";
import { useChatSessions } from "../store/chat-sessions";
import { useTabs } from "../store/tabs";
import { useToolApprovalQueue } from "../store/tool-approval-queue";
import { AgentPicker } from "./AgentPicker";
import { Icon } from "./Icon";
import { ToolDiffDialog } from "./ToolDiffDialog";

const EMPTY_LIST: readonly string[] = Object.freeze([]);

export interface WorkspaceChatPanelProps {
  /** Active workspace path. */
  workspaceId: string;
}

export function WorkspaceChatPanel({ workspaceId }: WorkspaceChatPanelProps) {
  const sessionsForWorkspace = useChatSessions((s) => s.byWorkspace[workspaceId] ?? EMPTY_LIST);
  const activeSessionId = useChatSessions((s) => s.activeSessionId);
  const createSession = useChatSessions((s) => s.createSession);
  const selectSession = useChatSessions((s) => s.selectSession);
  const appendMessage = useChatSessions((s) => s.appendMessage);
  const appendAssistantChunk = useChatSessions((s) => s.appendAssistantChunk);
  const sessionsMap = useChatSessions((s) => s.sessions);

  // ADR-0019 T6 / N5: 파서 생성은 모달이 아니라 *파서 모드 전환* 으로.
  const enterParser = useActivityMode((s) => s.enterParser);
  // 가운데 column 의 활성 파일 — 에이전트 컨텍스트(activeFile excerpt)에 사용.
  const activeTabPath = useTabs((s) => s.activePath);

  // Ensure there is always one session so the user has somewhere to type.
  useEffect(() => {
    if (!workspaceId) return;
    if (sessionsForWorkspace.length === 0) {
      createSession(workspaceId);
    } else if (!activeSessionId || !sessionsMap[activeSessionId]) {
      const first = sessionsForWorkspace[0];
      if (first) selectSession(first);
    }
  }, [
    workspaceId,
    sessionsForWorkspace,
    activeSessionId,
    sessionsMap,
    createSession,
    selectSession,
  ]);

  const session = useMemo(
    () => (activeSessionId ? sessionsMap[activeSessionId] : undefined),
    [activeSessionId, sessionsMap],
  );

  const resolveAgent = useAgentRegistry((s) => s.resolve);
  const pendingDiffs = useToolApprovalQueue((s) => s.queue);
  // Per-session ACP session id (from acp_start_session). Lazily populated.
  const acpSessionRef = useRef<Map<string, string>>(new Map());
  // Reverse: ACP session id → frontend chat session id.
  const acpToChatRef = useRef<Map<string, string>>(new Map());

  // ADR-0010 D2 / U2: Rust 가 ACP child process 로부터 받은 stream chunk 를
  // `acp:notification` 으로 emit. mount 동안 한 번만 listen + unmount detach.
  useEffect(() => {
    let unlisten: UnlistenFn | undefined;
    let cancelled = false;
    (async () => {
      try {
        const fn = await listen<AcpNotificationPayload>("acp:notification", (evt) => {
          handleAcpNotification(evt.payload, acpToChatRef.current, appendAssistantChunk);
        });
        if (cancelled) {
          fn();
          return;
        }
        unlisten = fn;
      } catch (err) {
        // jsdom / harness 환경: listen 실패는 무시 (Tauri 외 환경).
        console.warn("[WorkspaceChatPanel] acp:notification listen failed", err);
      }
    })();
    return () => {
      cancelled = true;
      unlisten?.();
    };
  }, [appendAssistantChunk]);

  const onSend = async (text: string) => {
    /* v8 ignore next -- the ChatStream Send button is disabled while there is no active session, so this guard never fires from the UI */
    if (!session) return;
    appendMessage(session.id, { role: "user", content: text });
    const agent = resolveAgent(workspaceId, session.id);
    if (!agent) {
      appendMessage(session.id, {
        role: "system",
        content: "No agent registered — open the picker to add one.",
      });
      return;
    }
    if (agent.kind === "api-key") {
      // ADR-0004 contract: api-key path keeps the legacy provider flow.
      appendMessage(session.id, {
        role: "assistant",
        content: `(api-key agent ${agent.label}: legacy provider path)`,
      });
      return;
    }
    try {
      let sessionAcpId = acpSessionRef.current.get(session.id);
      const isFirstMessage = !sessionAcpId;
      if (!sessionAcpId) {
        sessionAcpId = await getAcpAdapter().startSession(agent, workspaceId);
        acpSessionRef.current.set(session.id, sessionAcpId);
        acpToChatRef.current.set(sessionAcpId, session.id);
      }
      // context-aware prompt: 첫 메시지에 시스템 preamble + 활성 파일 첨부,
      // 후속 메시지엔 활성 파일 delta.
      const composed = await composeAgentInput({
        userText: text,
        workspaceId,
        activeFilePath: activeTabPath,
        includeSystemPreamble: isFirstMessage,
      });
      await getAcpAdapter().sendMessage(sessionAcpId, composed);
    } catch (err) {
      // String(err) on a plain object yields "[object Object]". Show actual shape.
      let detail: string;
      if (err instanceof Error) detail = err.message;
      else if (typeof err === "string") detail = err;
      else if (err && typeof err === "object") {
        const obj = err as Record<string, unknown>;
        const msg = typeof obj.message === "string" ? obj.message : null;
        try {
          detail = msg ?? JSON.stringify(err);
        } catch {
          detail = String(err);
        }
      } else {
        detail = String(err);
      }
      appendMessage(session.id, {
        role: "system",
        content: `Agent error: ${detail}`,
      });
    }
  };

  return (
    <section
      className="flex h-full min-h-0 flex-col"
      aria-label="Workspace chat"
      data-testid="workspace-chat-panel"
    >
      <header
        className="flex items-center justify-between border-[var(--color-border)] border-b px-3 py-1.5"
        data-testid="workspace-chat-toolbar"
      >
        <AgentPicker workspaceId={workspaceId} sessionId={activeSessionId} />
        {/* ADR-0019 T6 / N5: 런타임 파서 만들기 → 모달이 아니라 파서 모드 전환. */}
        <button
          type="button"
          data-testid="workspace-create-parser"
          onClick={() => enterParser()}
          className="inline-flex items-center gap-1 rounded border border-[var(--color-border)] px-2 py-0.5 text-[var(--color-muted)] text-xs hover:bg-[var(--color-border)]/40 hover:text-[var(--color-fg)]"
          title="파서 개발 모드 열기"
          aria-label="Open parser studio"
        >
          <Icon name="sparkle" size={12} />
          <Icon name="plus" size={12} />
          <span>Parser</span>
        </button>
      </header>
      {pendingDiffs.length > 0 && (
        <div
          data-testid="workspace-chat-tool-queue"
          className="border-[var(--color-border)] border-b p-3"
        >
          {pendingDiffs.map((p) => (
            <ToolDiffDialog key={p.id} proposal={p} />
          ))}
        </div>
      )}
      <div className="min-h-0 flex-1">
        <ChatStream
          messages={session?.messages ?? []}
          onSend={onSend}
          onRegisterParser={(src) => enterParser({ prefillSource: src })}
        />
      </div>
    </section>
  );
}

// Rust 측 `NotificationPayload` 와 동일 shape.
interface AcpNotificationPayload {
  sessionId: string;
  agentId: string;
  event: {
    kind: "sessionUpdate" | "permissionRequest" | "agentRequest" | "notification" | "closed";
    update?: {
      sessionId?: string;
      update?: {
        sessionUpdate?: string;
        content?: { type?: string; text?: string };
      };
    };
    requestId?: string | number;
    params?: unknown;
    method?: string;
    reason?: string;
  };
}

/**
 * Compose the actual text shipped to the ACP adapter so the agent knows
 * which workspace / file the user is talking about.
 *
 * - First message of a session: include a brief "Markspread environment"
 *   preamble + the active file's content (capped) for grounding.
 * - Subsequent messages: a slim context delta (workspace + active file
 *   path + content). We always re-send the path to handle file switches.
 */
async function composeAgentInput(args: {
  userText: string;
  workspaceId: string;
  activeFilePath: string | null;
  includeSystemPreamble: boolean;
}): Promise<string> {
  const { userText, workspaceId, activeFilePath, includeSystemPreamble } = args;
  const parts: string[] = [];

  if (includeSystemPreamble) {
    parts.push(
      [
        "[Markspread environment]",
        "You are integrated *into* the Markspread editor (a Tauri-based",
        "markdown reviewer). The user is editing the workspace and file shown",
        "below; when they say 'this file', 'the parser', 'add a section',",
        "they mean the active file. Operate as an in-editor assistant — not",
        "a generic chatbot. When the user asks you to write a runtime parser",
        "they mean: produce a JS factory function the user will load into the",
        "Parser Studio (via the code-block 'Parser' action) to register. When",
        "they ask you to",
        "edit a markdown file, output the unified diff or the full new",
        "content for them to apply.",
        "",
      ].join("\n"),
    );
  }

  parts.push(`[Workspace] ${workspaceId || "(none)"}`);

  if (activeFilePath) {
    parts.push(`[Active file] ${activeFilePath}`);
    const excerpt = await readActiveFileExcerpt(workspaceId, activeFilePath);
    if (excerpt) {
      parts.push("[Active file content (excerpt)]");
      parts.push("```");
      parts.push(excerpt);
      parts.push("```");
    }
  } else {
    parts.push("[Active file] (none — user has no file open)");
  }

  parts.push("");
  parts.push("[User message]");
  parts.push(userText);

  return parts.join("\n");
}

const MAX_EXCERPT_CHARS = 4000;

async function readActiveFileExcerpt(workspace: string, path: string): Promise<string | null> {
  if (!workspace || !path) return null;
  try {
    const result = await invoke<{ content: string; encoding: string }>("fs_read_file", {
      workspace,
      path,
    });
    if (!result?.content) return null;
    if (result.content.length <= MAX_EXCERPT_CHARS) return result.content;
    return `${result.content.slice(0, MAX_EXCERPT_CHARS)}\n…(truncated; total ${result.content.length} chars)`;
  } catch (e) {
    // 읽기 실패는 silent — agent 는 path 만 알고 진행.
    console.warn("[WorkspaceChatPanel] active file excerpt read failed", e);
    return null;
  }
}

function handleAcpNotification(
  payload: AcpNotificationPayload,
  acpToChat: Map<string, string>,
  appendChunk: (sessionId: string, chunk: string) => void,
): void {
  const chatSessionId = acpToChat.get(payload.sessionId);
  if (!chatSessionId) return;
  if (payload.event.kind !== "sessionUpdate") return;
  const inner = payload.event.update?.update;
  if (inner?.sessionUpdate !== "agent_message_chunk") return;
  const text = inner.content?.text;
  if (typeof text === "string" && text.length > 0) {
    appendChunk(chatSessionId, text);
  }
}
