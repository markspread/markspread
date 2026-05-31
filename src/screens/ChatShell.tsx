// ADR-0010 D2: ChatShell — chat-first three-column layout.
//
// Left (180px): WorkspaceNav (workspaces, chat sessions, "New chat").
// Center (flex): ChatStream — message list + bottom input box.
// Right (320px, collapsible): ContextPanel — compact tree + active
//   preview + pinned snippets + token gauge.
//
// Per the ADR's "lightweight" principle and the U1 scope, the chat
// input is intentionally a skeleton: it appends a user message + a
// placeholder assistant card. The real LLM wiring lands in U2.

import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import { useEffect, useMemo, useRef, useState } from "react";
import { AgentPicker } from "../components/AgentPicker";
import { ChatPreview } from "../components/ChatPreview";
import { CreateParserDialog } from "../components/CreateParserDialog";
import { EditorPane } from "../components/EditorPane";
import { Icon } from "../components/Icon";
import { ToolDiffDialog } from "../components/ToolDiffDialog";
import { getAcpAdapter } from "../lib/agents/acp-adapter";
import { isMarkdownPath } from "../lib/file-kind";
import { useAgentRegistry } from "../store/agent-registry";
import { useChatSessions } from "../store/chat-sessions";
import { useTabs } from "../store/tabs";
import { emitTelemetry } from "../store/telemetry";
import { useToolApprovalQueue } from "../store/tool-approval-queue";
import { useWorkspace } from "../store/workspace";
import { ChatStream } from "./chat/ChatStream";
import { ContextPanel } from "./chat/ContextPanel";
import { WorkspaceNav } from "./chat/WorkspaceNav";

export interface ChatShellProps {
  /** Override workspaceId in tests; defaults to useWorkspace.current. */
  workspaceIdOverride?: string;
}

export function ChatShell({ workspaceIdOverride }: ChatShellProps = {}) {
  const current = useWorkspace((s) => s.current);
  const setPreferredShell = useWorkspace((s) => s.setPreferredShell);
  const workspaceId = workspaceIdOverride ?? current ?? "";

  const sessionsForWorkspace = useChatSessions((s) => s.byWorkspace[workspaceId] ?? EMPTY_LIST);
  const activeSessionId = useChatSessions((s) => s.activeSessionId);
  const createSession = useChatSessions((s) => s.createSession);
  const selectSession = useChatSessions((s) => s.selectSession);
  const appendMessage = useChatSessions((s) => s.appendMessage);
  const appendAssistantChunk = useChatSessions((s) => s.appendAssistantChunk);
  const sessionsMap = useChatSessions((s) => s.sessions);

  const [navCollapsed, setNavCollapsed] = useState(false);
  const [contextCollapsed, setContextCollapsed] = useState(false);
  const [activeFilePath, setActiveFilePath] = useState<string | null>(null);
  // H4 / ADR-0013: chat 으로 만든 파서 등록 다이얼로그
  const [parserDialogOpen, setParserDialogOpen] = useState(false);
  /** Chat 의 코드블록 → "+ Parser" 버튼이 prefill 할 source. dialog 닫히면 reset. */
  const [parserPrefillSource, setParserPrefillSource] = useState<string>("");
  // FIX: FileTree 클릭 → useTabs.activePath 가 set 됨. ChatShell 이 그 값을 읽어
  //      가운데 column 에 EditorPane 을 렌더. 이전엔 ContextPanel 만 있어서 파일이 안 보였음.
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

  // shell.mounted — measured from the first commit. We capture the
  // start at module evaluation but reset on every mount so the first
  // useEffect fires close to the real paint moment.
  const mountedAt = useRef<number>(performance.now());
  useEffect(() => {
    const firstPaintMs = Math.max(0, performance.now() - mountedAt.current);
    emitTelemetry({
      type: "shell.mounted",
      shell: "chat",
      workspaceId,
      firstPaintMs,
    });
    // mountedAt is a ref — intentionally not in deps.
  }, [workspaceId]);

  const session = useMemo(
    () => (activeSessionId ? sessionsMap[activeSessionId] : undefined),
    [activeSessionId, sessionsMap],
  );

  const resolveAgent = useAgentRegistry((s) => s.resolve);
  const pendingDiffs = useToolApprovalQueue((s) => s.queue);
  // Per-session ACP session id (from acp_start_session). Lazily populated.
  const acpSessionRef = useRef<Map<string, string>>(new Map());
  // Reverse: ACP session id → frontend chat session id. Notification listener
  // 가 어느 chat session 에 chunk 를 append 할지 결정할 때 사용.
  const acpToChatRef = useRef<Map<string, string>>(new Map());

  // ADR-0010 D2 / U2: Rust 가 ACP child process 로부터 받은 stream chunk 를
  // `acp:notification` 으로 emit. ChatShell mount 동안 한 번만 listen 등록 +
  // unmount 시 detach. session_update.agent_message_chunk → 마지막 assistant
  // 메시지에 누적.
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
        console.warn("[ChatShell] acp:notification listen failed", err);
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
      // FIX: context-aware prompt. agent 가 "지금 markspread editor 안에서
      // 어떤 workspace/파일을 보고 있는지" 를 모르면 "파서 작성"·"마크다운
      // 수정" 같은 요청을 처리할 수 없음. 첫 메시지에 시스템 톤 preamble +
      // 활성 파일 첨부, 후속 메시지에는 활성 파일 delta 만.
      const composed = await composeAgentInput({
        userText: text,
        workspaceId,
        activeFilePath: activeTabPath,
        includeSystemPreamble: isFirstMessage,
      });
      await getAcpAdapter().sendMessage(sessionAcpId, composed);
    } catch (err) {
      // FIX: String(err) on a plain object yields "[object Object]". Show actual shape.
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

  const onSwitchToEditor = () => {
    setPreferredShell("editor");
    emitTelemetry({
      type: "shell.switched",
      from: "chat",
      to: "editor",
      trigger: "toolbar",
    });
    emitTelemetry({
      type: "editor.opened_via_escape_hatch",
      from: "chat",
      reason: "toolbar-toggle",
    });
  };

  return (
    <main className="flex h-full w-full flex-col" aria-label="Chat shell" data-shell="chat">
      <header
        className="flex items-center justify-between border-[var(--color-border)] border-b px-4 py-2"
        data-testid="chat-toolbar"
      >
        <div className="flex items-center gap-2">
          <button
            type="button"
            data-testid="chat-toggle-nav"
            aria-label={navCollapsed ? "Show workspace nav" : "Hide workspace nav"}
            aria-expanded={!navCollapsed}
            onClick={() => setNavCollapsed((v) => !v)}
            className="text-[var(--color-muted)] text-xs hover:text-[var(--color-fg)]"
          >
            {navCollapsed ? "›" : "‹"}
          </button>
          <span className="truncate font-medium text-sm" title={workspaceId}>
            {workspaceId || "(no workspace)"}
          </span>
          <AgentPicker workspaceId={workspaceId} sessionId={activeSessionId} />
        </div>
        <div className="flex items-center gap-3">
          {/* H4: 런타임 파서 만들기 (LLM 응답 코드 → 즉시 등록) */}
          <button
            type="button"
            data-testid="chat-create-parser"
            onClick={() => setParserDialogOpen(true)}
            className="inline-flex items-center gap-1 rounded border border-[var(--color-border)] px-2 py-0.5 text-[var(--color-muted)] text-xs hover:bg-[var(--color-border)]/40 hover:text-[var(--color-fg)]"
            title="LLM 응답을 런타임 파서로 등록"
            aria-label="Create runtime parser"
          >
            <Icon name="sparkle" size={12} />
            <Icon name="plus" size={12} />
            <span>Parser</span>
          </button>
          <button
            type="button"
            data-testid="chat-switch-editor"
            onClick={onSwitchToEditor}
            className="text-[var(--color-muted)] text-xs hover:text-[var(--color-fg)]"
          >
            Switch to Editor Shell
          </button>
          <button
            type="button"
            data-testid="chat-toggle-context"
            aria-label={contextCollapsed ? "Show context panel" : "Hide context panel"}
            aria-expanded={!contextCollapsed}
            onClick={() => setContextCollapsed((v) => !v)}
            className="text-[var(--color-muted)] text-xs hover:text-[var(--color-fg)]"
          >
            {contextCollapsed ? "‹" : "›"}
          </button>
        </div>
      </header>
      <div className="flex flex-1 overflow-hidden">
        {!navCollapsed && (
          <aside
            data-testid="chat-workspace-nav"
            className="w-[180px] shrink-0 overflow-hidden border-[var(--color-border)] border-r bg-[var(--color-surface-subtle)]"
            aria-label="Workspace navigation"
          >
            <WorkspaceNav
              workspaceId={workspaceId}
              sessions={sessionsForWorkspace
                .map((id) => sessionsMap[id])
                .filter((s): s is NonNullable<typeof s> => Boolean(s))}
              activeSessionId={activeSessionId}
              onSelect={(id) => selectSession(id)}
              onNew={() => createSession(workspaceId)}
            />
          </aside>
        )}
        <section
          className="flex min-h-0 min-w-0 flex-1 flex-col"
          aria-label="Chat stream"
          data-testid="chat-stream-region"
        >
          {pendingDiffs.length > 0 && (
            <div
              data-testid="chat-tool-queue"
              className="border-[var(--color-border)] border-b p-3"
            >
              {pendingDiffs.map((p) => (
                <ToolDiffDialog key={p.id} proposal={p} />
              ))}
            </div>
          )}
          {/* FIX: 파일 선택 시 — md 면 [에디터 | 미리보기] split, 비-md 면 에디터만. 채팅은 아래. */}
          {activeTabPath && workspaceId ? (
            <>
              <div className="flex min-h-0 flex-1 overflow-hidden" data-testid="chat-editor-region">
                <div className="flex min-w-0 flex-1 flex-col border-[var(--color-border)] border-r">
                  <EditorPane workspace={workspaceId} />
                </div>
                {isMarkdownPath(activeTabPath) && (
                  <div className="flex min-w-0 flex-1 flex-col" data-testid="chat-preview-region">
                    <ChatPreview workspace={workspaceId} documentPath={activeTabPath} />
                  </div>
                )}
              </div>
              <div
                className="flex min-h-[200px] max-h-[40%] flex-col border-[var(--color-border)] border-t"
                data-testid="chat-stream-bottom"
              >
                <ChatStream
                  messages={session?.messages ?? []}
                  onSend={onSend}
                  onRegisterParser={(src) => {
                    setParserPrefillSource(src);
                    setParserDialogOpen(true);
                  }}
                />
              </div>
            </>
          ) : (
            <ChatStream messages={session?.messages ?? []} onSend={onSend} />
          )}
        </section>
        {!contextCollapsed && (
          <aside
            data-testid="chat-context-panel"
            className="w-[320px] shrink-0 overflow-hidden border-[var(--color-border)] border-l bg-[var(--color-surface-subtle)]"
            aria-label="Context panel"
          >
            <ContextPanel
              workspaceId={workspaceId}
              activeFilePath={activeFilePath}
              onPickFile={setActiveFilePath}
            />
          </aside>
        )}
      </div>
      <CreateParserDialog
        open={parserDialogOpen}
        onClose={() => {
          setParserDialogOpen(false);
          setParserPrefillSource("");
        }}
        prefilledSource={parserPrefillSource}
      />
    </main>
  );
}

const EMPTY_LIST: readonly string[] = Object.freeze([]);

// Rust 측 `NotificationPayload` 와 동일 shape. event.kind 별로 다른 필드.
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
 * Compose the actual text shipped to the ACP adapter.
 *
 * Without this, the adapter receives only the raw user text and has no idea
 * which workspace / file / selection the user is talking about. The agent
 * then answers in a vacuum ("here's a generic markdown parser") instead of
 * acting on the file the user is staring at.
 *
 * - First message of a session: include a brief "Markspread environment"
 *   preamble so the agent self-identifies as an in-editor assistant + the
 *   active file's content (capped) for grounding.
 * - Subsequent messages: a slim context delta (workspace + active file path
 *   + content if changed). We always re-send the path to handle file
 *   switches mid-session.
 *
 * Excerpt cap: 4000 chars (≈ 1k tokens) to stay frugal — user can ask the
 * agent to read more of the file via tools later.
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
        "they mean: produce a JS factory function the user will register via",
        "the '+ Parser' button (see CreateParserDialog). When they ask you to",
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

async function readActiveFileExcerpt(
  workspace: string,
  path: string,
): Promise<string | null> {
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
    console.warn("[ChatShell] active file excerpt read failed", e);
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
