// ADR-0019 §Decision.1: the Workspace shell's Chat is a *toggle panel*,
// not a separate shell. This component owns the agent wiring that used
// to live in the now-deleted `ChatShell`:
//   - session bootstrap (always one session per workspace),
//   - the `acp:notification` stream listener,
//   - `onSend` → ACP adapter with a context-aware composed prompt,
//   - the queued tool-diff cards (permissionRequest → approval queue),
//   - ADR-0014 §5 drag-chat edit: selection-scoped requests → inline diff
//     overlay with Enter/Esc/Cmd+R decisions,
//   - the `+ Parser` entry (mode switch, never a modal — N5),
//   - code-block "파서로 만들기" → enterParser({prefillSource}).
//
// It is intentionally surface-agnostic: WorkspaceShell mounts it at the
// bottom of the document column, and it reads the active file from
// `useTabs` so the agent always knows which document the user is on.

import { invoke } from "@tauri-apps/api/core";
import { type UnlistenFn, listen } from "@tauri-apps/api/event";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { getAcpAdapter } from "../lib/agents/acp-adapter";
import type { RegisteredAgent } from "../lib/agents/types";
import {
  type Decision,
  type InlineDiff,
  type SelectionContext,
  applyDecision,
  computeInlineDiff,
} from "../lib/editor/drag-chat-edit";
import { saveTab } from "../lib/save-tab";
import { ChatStream } from "../screens/chat/ChatStream";
import { useActivityMode } from "../store/activity-mode";
import { useAgentRegistry } from "../store/agent-registry";
import { useChatSessions } from "../store/chat-sessions";
import { useDocCache } from "../store/doc-cache";
import { type RawSelectionRange, useDragChatSelection } from "../store/drag-chat-selection";
import { useTabs } from "../store/tabs";
import {
  type DiffProposal,
  type DiffToolKind,
  useToolApprovalQueue,
} from "../store/tool-approval-queue";
import { AgentPicker } from "./AgentPicker";
import { Icon } from "./Icon";
import { InlineDiffOverlay } from "./InlineDiffOverlay";
import { ToolDiffDialog } from "./ToolDiffDialog";

const EMPTY_LIST: readonly string[] = Object.freeze([]);

export interface WorkspaceChatPanelProps {
  /** Active workspace path. */
  workspaceId: string;
}

/** ADR-0014 §5: one in-flight drag-edit round (selection → proposal). */
interface DragEditFlow {
  selection: SelectionContext;
  raw: RawSelectionRange;
  screenPosition: { top: number; left: number } | null;
  /** The user's natural-language request — reused verbatim on Cmd+R. */
  prompt: string;
  /** null while a (re)request is in flight; set when the proposal lands. */
  diff: InlineDiff | null;
  /** Cmd+R 재요청은 1회 — 이미 소진되면 이후 retry 는 무시된다. */
  retryUsed: boolean;
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
  // ADR-0014 H13: 에디터 드래그 선택 — 있으면 다음 채팅 요청이 선택-편집 플로우.
  const activeSelection = useDragChatSelection((s) => s.current);

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
  // ADR-0014 §5: while a drag-edit request is in flight, streamed chunks
  // for that ACP session are also accumulated here as the proposal text.
  const dragCaptureRef = useRef<{ acpSessionId: string; buffer: string } | null>(null);
  const [dragEdit, setDragEdit] = useState<DragEditFlow | null>(null);

  // ADR-0010 D2 / U2: Rust 가 ACP child process 로부터 받은 stream chunk 를
  // `acp:notification` 으로 emit. mount 동안 한 번만 listen + unmount detach.
  useEffect(() => {
    let unlisten: UnlistenFn | undefined;
    let cancelled = false;
    (async () => {
      try {
        const fn = await listen<AcpNotificationPayload>("acp:notification", (evt) => {
          handleAcpNotification(evt.payload, {
            acpToChat: acpToChatRef.current,
            appendChunk: appendAssistantChunk,
            tapChunk: (acpSessionId, text) => {
              const cap = dragCaptureRef.current;
              if (cap && cap.acpSessionId === acpSessionId) cap.buffer += text;
            },
            onPermissionRequest: enqueuePermissionRequest,
          });
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

  /** Start (or reuse) the ACP session backing a chat session. */
  const ensureAcpSession = useCallback(
    async (
      chatSessionId: string,
      agent: RegisteredAgent,
    ): Promise<{ acpSessionId: string; isFirstMessage: boolean }> => {
      let acpSessionId = acpSessionRef.current.get(chatSessionId);
      const isFirstMessage = !acpSessionId;
      if (!acpSessionId) {
        acpSessionId = await getAcpAdapter().startSession(agent, workspaceId);
        acpSessionRef.current.set(chatSessionId, acpSessionId);
        acpToChatRef.current.set(acpSessionId, chatSessionId);
      }
      return { acpSessionId, isFirstMessage };
    },
    [workspaceId],
  );

  // ADR-0014 §5 (SC-DRAG-01/04): 선택-편집 요청 1회 실행. AI 응답을 선택
  // 텍스트 대비 인라인 diff 로 만들어 overlay 를 띄운다. lane 은 일반 채팅과
  // 동일한 ACP 경로를 재사용 — 플로우 자체는 lane 에 독립적.
  const runDragEditRequest = useCallback(
    async (args: {
      prompt: string;
      selection: SelectionContext;
      raw: RawSelectionRange;
      screenPosition: { top: number; left: number } | null;
      isRetry: boolean;
    }) => {
      if (!session) return;
      const { prompt, selection, raw, screenPosition, isRetry } = args;
      if (!isRetry) appendMessage(session.id, { role: "user", content: prompt });
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
        const { acpSessionId } = await ensureAcpSession(session.id, agent);
        const composed = composeDragEditPrompt({ userText: prompt, selection, isRetry });
        dragCaptureRef.current = { acpSessionId, buffer: "" };
        await getAcpAdapter().sendMessage(acpSessionId, composed);
        const buffered = dragCaptureRef.current?.buffer ?? "";
        dragCaptureRef.current = null;
        const proposed = extractProposedText(buffered);
        if (!proposed) {
          appendMessage(session.id, {
            role: "system",
            content: "Drag-edit: the agent returned no replacement text — document left unchanged.",
          });
          return;
        }
        const diff = computeInlineDiff(selection.selectedText, proposed);
        setDragEdit({ selection, raw, screenPosition, prompt, diff, retryUsed: isRetry });
      } catch (err) {
        dragCaptureRef.current = null;
        appendMessage(session.id, {
          role: "system",
          content: `Agent error: ${describeError(err)}`,
        });
      }
    },
    [session, workspaceId, resolveAgent, appendMessage, ensureAcpSession],
  );

  // ADR-0014 §5 (SC-DRAG-02/03/04): Enter=accept / Esc=reject / Cmd+R=retry(1회).
  const handleDragDecision = useCallback(
    async (decision: Decision) => {
      const flow = dragEdit;
      if (!flow?.diff) return;
      if (decision === "retry") {
        // 재요청은 1회 — 이미 소진했으면 조용히 무시 (overlay 유지).
        if (flow.retryUsed) return;
        const result = applyDecision(flow.diff, "retry");
        if (session) appendMessage(session.id, { role: "system", content: result.auditLine });
        setDragEdit({ ...flow, diff: null, retryUsed: true });
        await runDragEditRequest({
          prompt: flow.prompt,
          selection: flow.selection,
          raw: flow.raw,
          screenPosition: flow.screenPosition,
          isRetry: true,
        });
        return;
      }
      const result = applyDecision(flow.diff, decision);
      if (decision === "accept" && result.newText !== null) {
        const { fullText, fromOffset, toOffset } = flow.raw;
        const nextDoc = fullText.slice(0, fromOffset) + result.newText + fullText.slice(toOffset);
        // 에디터 반영: doc-cache live 갱신 → 열려 있는 모든 pane 의 Editor 가
        // remoteDoc reconcile 로 즉시 새 내용을 보여준다 (S-ESP-007 경로).
        useDocCache.getState().setLive(workspaceId, flow.selection.filePath, nextDoc);
        // 디스크 반영: 기존 저장 경로(S-FT-018) 재사용 — orphan/실패 토스트 포함.
        await saveTab({ workspace: workspaceId, path: flow.selection.filePath, content: nextDoc });
      }
      if (session) appendMessage(session.id, { role: "system", content: result.auditLine });
      setDragEdit(null);
      useDragChatSelection.getState().clear();
    },
    [dragEdit, session, workspaceId, appendMessage, runDragEditRequest],
  );

  // Overlay 가 떠 있는 동안 Enter/Esc/Cmd+R 은 diff 결정 키다 (capture 단계
  // 에서 가로채 CM/textarea 의 기본 동작을 막는다 — 결정이 최우선).
  useEffect(() => {
    if (!dragEdit?.diff) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Enter" && !e.shiftKey) {
        e.preventDefault();
        e.stopPropagation();
        void handleDragDecision("accept");
      } else if (e.key === "Escape") {
        e.preventDefault();
        e.stopPropagation();
        void handleDragDecision("reject");
      } else if ((e.key === "r" || e.key === "R") && (e.metaKey || e.ctrlKey)) {
        e.preventDefault();
        e.stopPropagation();
        void handleDragDecision("retry");
      }
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [dragEdit, handleDragDecision]);

  const onSend = async (text: string) => {
    /* v8 ignore next -- the ChatStream Send button is disabled while there is no active session, so this guard never fires from the UI */
    if (!session) return;
    // ADR-0014 §5: 활성 드래그 선택이 있으면 이 요청은 선택-편집 플로우다.
    const selState = useDragChatSelection.getState();
    if (selState.current && selState.raw) {
      await runDragEditRequest({
        prompt: text,
        selection: selState.current,
        raw: selState.raw,
        screenPosition: selState.screenPosition,
        isRetry: false,
      });
      return;
    }
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
      const { acpSessionId, isFirstMessage } = await ensureAcpSession(session.id, agent);
      // context-aware prompt: 첫 메시지에 시스템 preamble + 활성 파일 첨부,
      // 후속 메시지엔 활성 파일 delta.
      const composed = await composeAgentInput({
        userText: text,
        workspaceId,
        activeFilePath: activeTabPath,
        includeSystemPreamble: isFirstMessage,
      });
      await getAcpAdapter().sendMessage(acpSessionId, composed);
    } catch (err) {
      appendMessage(session.id, {
        role: "system",
        content: `Agent error: ${describeError(err)}`,
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
      {/* ADR-0014 H13: 활성 선택 chip — 다음 요청이 선택-편집으로 라우팅됨을 표시. */}
      {activeSelection && !dragEdit && (
        <div
          data-testid="drag-chat-selection-chip"
          className="flex items-center justify-between gap-2 border-[var(--color-border)] border-b bg-[var(--color-surface-subtle)] px-3 py-1.5 text-xs"
        >
          <span className="truncate text-[var(--color-muted)]">
            선택 편집: {activeSelection.filePath} L{activeSelection.from.line}–L
            {activeSelection.to.line}
          </span>
          <button
            type="button"
            data-testid="drag-chat-selection-clear"
            aria-label="Clear selection target"
            onClick={() => useDragChatSelection.getState().clear()}
            className="shrink-0 rounded px-1 text-[var(--color-muted)] hover:bg-[var(--color-border)]/40 hover:text-[var(--color-fg)]"
          >
            ✕
          </button>
        </div>
      )}
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
      {/* ADR-0014 §5: AI 제안 인라인 diff — 선택 좌표가 있으면 그 위치에. */}
      {dragEdit?.diff && (
        <InlineDiffOverlay
          diff={dragEdit.diff}
          {...(dragEdit.screenPosition ? { position: dragEdit.screenPosition } : {})}
          onDecision={(d) => void handleDragDecision(d)}
        />
      )}
    </section>
  );
}

// Rust 측 `NotificationPayload` 와 동일 shape.
export interface AcpNotificationPayload {
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

function describeError(err: unknown): string {
  // String(err) on a plain object yields "[object Object]". Show actual shape.
  if (err instanceof Error) return err.message;
  if (typeof err === "string") return err;
  if (err && typeof err === "object") {
    const obj = err as Record<string, unknown>;
    const msg = typeof obj.message === "string" ? obj.message : null;
    try {
      return msg ?? JSON.stringify(err);
    } catch {
      return String(err);
    }
  }
  return String(err);
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

/**
 * ADR-0014 §5: prompt for a selection-scoped edit. Self-contained — the
 * agent is told to answer with the bare replacement text so the response
 * can be diffed against the selection verbatim.
 */
function composeDragEditPrompt(args: {
  userText: string;
  selection: SelectionContext;
  isRetry: boolean;
}): string {
  const { userText, selection, isRetry } = args;
  const parts: string[] = [
    "[Markspread drag-edit request]",
    "The user selected a region of a markdown document and asked for an",
    "edit. Respond with ONLY the replacement text for the selected region —",
    "no code fences, no commentary, no surrounding context. Your entire",
    "response replaces the selection verbatim.",
    "",
    `[File] ${selection.filePath}`,
    `[Selection] L${selection.from.line}:C${selection.from.col} – L${selection.to.line}:C${selection.to.col}`,
    "[Selected text]",
    selection.selectedText,
  ];
  const ctx = selection.surroundingContext;
  if (ctx?.before) {
    parts.push("", "[Context before selection]", ctx.before);
  }
  if (ctx?.after) {
    parts.push("", "[Context after selection]", ctx.after);
  }
  if (isRetry) {
    parts.push("", "[Retry] The previous suggestion was declined. Propose a different revision.");
  }
  parts.push("", "[User request]", userText);
  return parts.join("\n");
}

/**
 * The agent is instructed not to fence its reply, but models do it anyway;
 * strip one wrapping ``` fence so the diff compares real content.
 */
export function extractProposedText(raw: string): string {
  let t = raw.trim();
  if (t.startsWith("```") && t.endsWith("```")) {
    const firstNl = t.indexOf("\n");
    if (firstNl !== -1) {
      t = t.slice(firstNl + 1, t.length - 3).replace(/\n$/, "");
    }
  }
  return t;
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

interface AcpNotificationHandlers {
  acpToChat: Map<string, string>;
  appendChunk: (chatSessionId: string, chunk: string) => void;
  /** Drag-edit proposal capture — receives every streamed chunk. */
  tapChunk?: (acpSessionId: string, text: string) => void;
  /** SC-CHAT-01/02: `session/request_permission` → approval queue. */
  onPermissionRequest?: (payload: AcpNotificationPayload) => void;
}

function handleAcpNotification(
  payload: AcpNotificationPayload,
  handlers: AcpNotificationHandlers,
): void {
  const chatSessionId = handlers.acpToChat.get(payload.sessionId);
  if (!chatSessionId) return;
  if (payload.event.kind === "permissionRequest") {
    handlers.onPermissionRequest?.(payload);
    return;
  }
  if (payload.event.kind !== "sessionUpdate") return;
  const inner = payload.event.update?.update;
  if (inner?.sessionUpdate !== "agent_message_chunk") return;
  const text = inner.content?.text;
  if (typeof text === "string" && text.length > 0) {
    handlers.tapChunk?.(payload.sessionId, text);
    handlers.appendChunk(chatSessionId, text);
  }
}

// ─── SC-CHAT-01/02: permissionRequest → approval queue ─────────────────

function asString(v: unknown): string | null {
  return typeof v === "string" && v.length > 0 ? v : null;
}

function inferToolKind(kind: string | null, summary: string): DiffToolKind {
  const k = (kind ?? "").toLowerCase();
  if (k === "edit") return "edit_file";
  if (k === "write" || k === "create") return "write_file";
  const s = summary.toLowerCase();
  if (s.includes("write") || s.includes("create") || s.includes("생성") || s.includes("작성")) {
    return "write_file";
  }
  return "edit_file";
}

/**
 * Map a `permissionRequest` notification onto a queue `DiffProposal`.
 *
 * The Rust event today carries `{sessionId, toolCallId, summary}`; richer
 * adapters additionally embed the concrete tool call (title, locations,
 * diff content) — all of it is picked up defensively when present so the
 * card can show a real before/after instead of just the summary.
 */
export function permissionRequestToProposal(
  payload: AcpNotificationPayload,
): Omit<DiffProposal, "id" | "createdAt"> | null {
  if (payload.event.kind !== "permissionRequest") return null;
  const requestId = payload.event.requestId;
  if (requestId === undefined || requestId === null) return null;
  const params = (
    payload.event.params && typeof payload.event.params === "object" ? payload.event.params : {}
  ) as Record<string, unknown>;
  const toolCall = (
    params.toolCall && typeof params.toolCall === "object" ? params.toolCall : {}
  ) as Record<string, unknown>;

  const toolCallId = asString(params.toolCallId) ?? asString(toolCall.toolCallId) ?? "";
  const summary = asString(params.summary) ?? asString(toolCall.title) ?? "";

  let filePath = asString(params.path) ?? "";
  let before = "";
  let after = "";
  const contents = Array.isArray(toolCall.content) ? toolCall.content : [];
  for (const entry of contents) {
    if (entry && typeof entry === "object") {
      const d = entry as Record<string, unknown>;
      if (d.type === "diff") {
        filePath = filePath || (asString(d.path) ?? "");
        before = asString(d.oldText) ?? "";
        after = asString(d.newText) ?? "";
        break;
      }
    }
  }
  if (!filePath) {
    const locations = Array.isArray(toolCall.locations) ? toolCall.locations : [];
    const first = locations[0];
    if (first && typeof first === "object") {
      filePath = asString((first as Record<string, unknown>).path) ?? "";
    }
  }

  return {
    sessionId: payload.sessionId,
    agentId: payload.agentId,
    toolCallId,
    requestId,
    tool: inferToolKind(asString(toolCall.kind), summary),
    filePath,
    before,
    after,
    summary,
  };
}

/**
 * SC-CHAT-01/02 wiring: queue the permission request so the ToolDiffDialog
 * card surfaces it; the user's Accept/Reject → `acp_approve_diff` → Rust
 * answers the agent, which then performs (or skips) the real fs write.
 * A session with "approve all" armed skips the card and allows immediately.
 */
export function enqueuePermissionRequest(payload: AcpNotificationPayload): void {
  const proposal = permissionRequestToProposal(payload);
  if (!proposal) return;
  const q = useToolApprovalQueue.getState();
  const entry = q.enqueue(proposal);
  if (q.approveAllBySession[entry.sessionId]) {
    void q.decide(entry.id, "accept_all");
  }
}
