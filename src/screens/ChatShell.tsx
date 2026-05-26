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

import { useEffect, useMemo, useRef, useState } from "react";
import { useChatSessions } from "../store/chat-sessions";
import { emitTelemetry } from "../store/telemetry";
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
  const sessionsMap = useChatSessions((s) => s.sessions);

  const [navCollapsed, setNavCollapsed] = useState(false);
  const [contextCollapsed, setContextCollapsed] = useState(false);
  const [activeFilePath, setActiveFilePath] = useState<string | null>(null);

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

  const onSend = (text: string) => {
    /* v8 ignore next -- the ChatStream Send button is disabled while there is no active session, so this guard never fires from the UI */
    if (!session) return;
    appendMessage(session.id, { role: "user", content: text });
    appendMessage(session.id, {
      role: "assistant",
      content: "Agent SDK not yet connected. (U2 will wire the response stream.)",
    });
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
        </div>
        <div className="flex items-center gap-3">
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
          <ChatStream messages={session?.messages ?? []} onSend={onSend} />
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
    </main>
  );
}

const EMPTY_LIST: readonly string[] = Object.freeze([]);
