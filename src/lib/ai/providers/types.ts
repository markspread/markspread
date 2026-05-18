// S-AI-RUN-001: shared provider adapter types.
//
// Each provider adapter (anthropic.ts, openai.ts, ollama.ts) exposes the
// same `call(opts): AsyncIterable<ChatChunk>` surface so runner.ts can
// route by providerId without knowing wire-format specifics. Non-streaming
// callers just collect chunks into a final string.

export type ChatRole = "system" | "user" | "assistant" | "tool";

export interface ChatMessage {
  role: ChatRole;
  content: string;
  /** Optional tool-call name for `role: "tool"` responses. */
  name?: string;
}

export interface ToolSpec {
  name: string;
  description?: string;
  /** JSON Schema object describing the tool's input. */
  parameters: unknown;
}

export interface CallOptions {
  apiKey: string;
  model: string;
  messages: ChatMessage[];
  tools?: ToolSpec[];
  /** Stream chunks as they arrive. False returns one final chunk. */
  stream?: boolean;
  /** Optional override (Ollama / azure / openai-compatible). */
  baseUrl?: string;
  /** AbortSignal so the caller can cancel mid-stream. */
  signal?: AbortSignal;
  /** Sampling controls — passed through verbatim when defined. */
  temperature?: number;
  maxTokens?: number;
}

export interface UsageTokens {
  inputTokens: number;
  outputTokens: number;
}

export type ChatChunk =
  | { kind: "text"; delta: string }
  | { kind: "tool-call"; id: string; name: string; argsJson: string }
  | { kind: "done"; usage: UsageTokens; finishReason: string }
  | { kind: "error"; message: string };

export interface ProviderAdapter {
  call(opts: CallOptions): AsyncIterable<ChatChunk>;
}
