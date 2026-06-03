// ADR-0010 D2 (center column): message list + input box. The list is a
// flat scroll for U1; tool-call cards and artifact diffs land in U2.
// The input box is the lightest possible skeleton — text input + Enter
// to send. No LLM client.

import { type KeyboardEvent, type ReactNode, useCallback, useMemo, useRef, useState } from "react";
import { Icon } from "../../components/Icon";
import type { ChatMessage } from "../../store/chat-sessions";

export interface ChatStreamProps {
  messages: ChatMessage[];
  onSend: (text: string) => void;
  /**
   * 사용자가 assistant 응답의 `\`\`\`js/javascript` 코드 블록 옆 "파서로 만들기"
   * 버튼을 눌렀을 때 호출. 호출자가 *파서 개발 모드로 전환* 하며 이 소스를
   * 워크벤치에 prefill 한다 (ADR-0019 T6 / N5 — 모달 아님). 미제공 시 버튼 숨김.
   */
  onRegisterParser?: (source: string) => void;
}

export function ChatStream({ messages, onSend, onRegisterParser }: ChatStreamProps) {
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
            <MessageBody content={m.content} role={m.role} onRegisterParser={onRegisterParser} />
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

/**
 * Assistant 메시지에 포함된 ```js / ```javascript / ```ts 코드 블록을 인식해서
 * 각 블록 뒤에 "파서로 만들기" 액션 버튼을 노출. 버튼 클릭 → onRegisterParser(소스)
 * → 상위가 *파서 개발 모드로 전환* 하며 그 소스를 워크벤치에 prefill 한다.
 *
 * 현재 ACP tool flow 가 미구현이므로 (Phase B), assistant 가 만든 파서 코드를
 * 즉시 워크벤치까지 가는 가장 짧은 동선. plain text/diff/다른 언어 코드 블록은
 * 그대로 표시.
 */
function MessageBody({
  content,
  role,
  onRegisterParser,
}: {
  content: string;
  role: ChatMessage["role"];
  onRegisterParser: ((source: string) => void) | undefined;
}): ReactNode {
  const segments = useMemo(() => parseMessageSegments(content), [content]);
  if (segments.length === 1 && segments[0]?.kind === "text") {
    return <div>{content}</div>;
  }
  return (
    <div>
      {segments.map((seg, i) => {
        if (seg.kind === "text") {
          return (
            // biome-ignore lint/suspicious/noArrayIndexKey: segments are positional, re-parsed wholesale on content change, and never reorder — index is the stable identity
            <div key={i} className="whitespace-pre-wrap">
              {seg.text}
            </div>
          );
        }
        const isJs =
          seg.lang === "js" ||
          seg.lang === "javascript" ||
          seg.lang === "ts" ||
          seg.lang === "typescript";
        const showRegister = isJs && role === "assistant" && onRegisterParser;
        return (
          <div
            // biome-ignore lint/suspicious/noArrayIndexKey: segments are positional, re-parsed wholesale on content change, and never reorder — index is the stable identity
            key={i}
            className="my-2 rounded border border-[var(--color-border)] bg-[var(--color-surface-subtle)]"
          >
            <div className="flex items-center justify-between border-[var(--color-border)] border-b px-2 py-1">
              <span className="text-[var(--color-muted)] text-xs font-mono">
                {seg.lang || "code"}
              </span>
              {showRegister && (
                <button
                  type="button"
                  data-testid="chat-codeblock-register-parser"
                  onClick={() => onRegisterParser(seg.code)}
                  className="inline-flex items-center gap-1 rounded border border-[var(--color-border)] px-2 py-0.5 text-xs hover:bg-[var(--color-border)]/40"
                  title="이 코드로 파서 개발 모드 열기 (소스 prefill)"
                >
                  <Icon name="sparkle" size={12} />
                  <Icon name="plus" size={12} />
                  <span>Parser</span>
                </button>
              )}
            </div>
            <pre className="overflow-auto p-2 font-mono text-xs leading-snug">
              <code>{seg.code}</code>
            </pre>
          </div>
        );
      })}
    </div>
  );
}

type Segment = { kind: "text"; text: string } | { kind: "code"; lang: string; code: string };

const FENCE_RE = /```([a-zA-Z0-9_+-]*)\n([\s\S]*?)```/g;

function parseMessageSegments(content: string): Segment[] {
  if (!content) return [{ kind: "text", text: "" }];
  const out: Segment[] = [];
  let lastIdx = 0;
  const re = new RegExp(FENCE_RE.source, FENCE_RE.flags);
  let m: RegExpExecArray | null = re.exec(content);
  while (m !== null) {
    if (m.index > lastIdx) {
      out.push({ kind: "text", text: content.slice(lastIdx, m.index) });
    }
    /* v8 ignore next -- regex group 2 ([\s\S]*?) always participates in a successful match, so m[2] is never undefined; the `?? ""` is a noUncheckedIndexedAccess type-guard */
    out.push({ kind: "code", lang: (m[1] || "").trim().toLowerCase(), code: m[2] ?? "" });
    lastIdx = m.index + m[0].length;
    m = re.exec(content);
  }
  if (lastIdx < content.length) {
    out.push({ kind: "text", text: content.slice(lastIdx) });
  }
  /* v8 ignore next -- content is non-empty here (empty content returns at the top), so the fence loop or the trailing-slice push always yields ≥1 segment; the empty-out fallback is defensive */
  return out.length === 0 ? [{ kind: "text", text: content }] : out;
}
