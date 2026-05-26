// ADR-0010 D2 (left column): workspace list + chat sessions + "New chat"
// CTA. Minimal-by-design for U1 — the workspace list is read-only
// (multi-workspace switching lives in ADR-0011 and surfaces via the
// command palette).

import type { ChatSession } from "../../store/chat-sessions";

export interface WorkspaceNavProps {
  workspaceId: string;
  sessions: ChatSession[];
  activeSessionId: string | null;
  onSelect: (id: string) => void;
  onNew: () => void;
}

export function WorkspaceNav({
  workspaceId,
  sessions,
  activeSessionId,
  onSelect,
  onNew,
}: WorkspaceNavProps) {
  return (
    <div className="flex h-full flex-col">
      <div className="border-[var(--color-border)] border-b p-2">
        <button
          type="button"
          data-testid="chat-new-session"
          onClick={onNew}
          className="w-full rounded bg-[var(--color-accent)] px-2 py-1 text-xs text-white hover:opacity-90"
        >
          + New chat
        </button>
      </div>
      <div className="border-[var(--color-border)] border-b px-2 py-1 text-[var(--color-muted)] text-xs uppercase tracking-wide">
        {workspaceId || "(none)"}
      </div>
      <ul className="flex-1 overflow-auto" aria-label="Chat sessions">
        {sessions.map((s) => (
          <li key={s.id}>
            <button
              type="button"
              data-testid={`chat-session-${s.id}`}
              data-active={s.id === activeSessionId ? "true" : "false"}
              onClick={() => onSelect(s.id)}
              className={`w-full truncate px-2 py-1 text-left text-xs hover:bg-[var(--color-surface)] ${s.id === activeSessionId ? "bg-[var(--color-surface)] font-medium" : ""}`}
              title={s.title}
            >
              {s.title}
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}
