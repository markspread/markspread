// ADR-0010 D2 (center column): message list + input box. The list is a
// flat scroll for U1; tool-call cards and artifact diffs land in U2.
// The input box is the lightest possible skeleton — text input + Enter
// to send. No LLM client.

import { type KeyboardEvent, useCallback, useRef, useState } from "react";
import type { ChatMessage } from "../../store/chat-sessions";

export interface ChatStreamProps {
  messages: ChatMessage[];
  onSend: (text: string) => void;
}

export function ChatStream({ messages, onSend }: ChatStreamProps) {
  const [draft, setDraft] = useState("");
  const inputRef = useRef<HTMLTextAreaElement | null>(null);

  const send = useCallback(() => {
    const trimmed = draft.trim();
    if (!trimmed) return;
    onSend(trimmed);
    setDraft("");
  }, [draft, onSend]);

  const onKeyDown = useCallback(
    (e: KeyboardEvent<HTMLTextAreaElement>) => {
      // Enter sends (Shift+Enter inserts a newline). Mod+Enter also
      // sends so the keybinding scope `chat` Mod+Enter has parity.
      if (e.key === "Enter" && !e.shiftKey) {
        e.preventDefault();
        send();
      }
    },
    [send],
  );

  return (
    <div className="flex h-full flex-col">
      <ol
        className="flex-1 overflow-auto px-4 py-3"
        aria-label="Chat messages"
        data-testid="chat-messages"
      >
        {messages.length === 0 && (
          <li className="text-[var(--color-muted)] text-sm">Ask anything about this workspace.</li>
        )}
        {messages.map((m) => (
          <li
            key={m.id}
            data-role={m.role}
            data-testid={`chat-msg-${m.role}`}
            className={`mb-3 whitespace-pre-wrap rounded p-2 text-sm ${m.role === "user" ? "bg-[var(--color-surface)] text-[var(--color-fg)]" : "border border-[var(--color-border)]"}`}
          >
            <div className="mb-1 text-[var(--color-muted)] text-xs uppercase tracking-wide">
              {m.role}
            </div>
            <div>{m.content}</div>
          </li>
        ))}
      </ol>
      <div className="border-[var(--color-border)] border-t p-3">
        <textarea
          ref={inputRef}
          data-testid="chat-input"
          aria-label="Chat input"
          value={draft}
          rows={2}
          placeholder="Type a message — Enter to send, Shift+Enter for newline"
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={onKeyDown}
          className="w-full resize-none rounded border border-[var(--color-border)] bg-[var(--color-surface)] p-2 text-sm focus:outline-none focus:ring-1 focus:ring-[var(--color-accent)]"
        />
        <div className="mt-2 flex justify-end">
          <button
            type="button"
            data-testid="chat-send"
            onClick={send}
            disabled={!draft.trim()}
            className="rounded bg-[var(--color-accent)] px-3 py-1 text-xs text-white hover:opacity-90 disabled:opacity-40"
          >
            Send
          </button>
        </div>
      </div>
    </div>
  );
}
