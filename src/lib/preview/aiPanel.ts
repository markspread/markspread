// S-PR-016: long-running AI conversation panel.
//
// Pure data-layer. The host injects a session adapter (a thin
// wrapper around the AI provider registry from the AI unit). This
// module owns:
//   • per-doc conversation state (in-memory)
//   • streamed message accumulation with abort support
//   • opaque message IDs so the UI can key by them
//
// Persistence (rehydrate across sessions) is the host's job; we
// expose `serialize()` / `restore()` for that.

export interface AiPanelMessage {
  id: string;
  role: "user" | "assistant" | "system";
  content: string;
  /** Provider/model used to produce this turn. */
  model?: string;
  /** Wall-clock when the turn started. */
  startedAt: number;
}

export interface AiPanelAdapter {
  /** Send a turn; resolves once the assistant message is fully
   * accumulated. Streams partials via `onDelta`. */
  send(opts: {
    history: AiPanelMessage[];
    abortSignal: AbortSignal;
    onDelta: (delta: string) => void;
  }): Promise<{ content: string; model: string }>;
}

export interface AiPanel {
  messages: AiPanelMessage[];
  send(content: string): Promise<void>;
  abort(): void;
  clear(): void;
  serialize(): AiPanelMessage[];
  restore(messages: AiPanelMessage[]): void;
  subscribe(listener: () => void): () => void;
}

let idSeq = 0;
function nextId(): string {
  return `m${++idSeq}-${Date.now().toString(36)}`;
}

export function createAiPanel(adapter: AiPanelAdapter): AiPanel {
  let messages: AiPanelMessage[] = [];
  const listeners = new Set<() => void>();
  let aborter: AbortController | null = null;
  const notify = () => {
    for (const fn of listeners) fn();
  };
  return {
    get messages() {
      return messages;
    },
    async send(content: string) {
      const userMsg: AiPanelMessage = {
        id: nextId(),
        role: "user",
        content,
        startedAt: Date.now(),
      };
      const assistant: AiPanelMessage = {
        id: nextId(),
        role: "assistant",
        content: "",
        startedAt: Date.now(),
      };
      messages = [...messages, userMsg, assistant];
      notify();
      aborter = new AbortController();
      try {
        const out = await adapter.send({
          history: messages.slice(0, -1),
          abortSignal: aborter.signal,
          onDelta: (delta) => {
            assistant.content += delta;
            messages = [...messages]; // identity flip for React
            notify();
          },
        });
        assistant.content = out.content;
        assistant.model = out.model;
        messages = [...messages];
        notify();
      } catch (err) {
        assistant.content += `${assistant.content ? "\n\n" : ""}*[error: ${(err as Error).message}]*`;
        messages = [...messages];
        notify();
      } finally {
        aborter = null;
      }
    },
    abort() {
      aborter?.abort();
    },
    clear() {
      aborter?.abort();
      messages = [];
      notify();
    },
    serialize() {
      return messages.slice();
    },
    restore(restored: AiPanelMessage[]) {
      messages = restored.slice();
      notify();
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
}
