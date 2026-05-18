// T-U13-001-FIX-A: Anthropic Messages API adapter.
//
// Wire format docs: https://docs.anthropic.com/en/api/messages
//
// Auth: `x-api-key` header (Anthropic uses this rather than Bearer). The
// raw key is fetched via `invoke('ai_key_resolve', { alias })` at call
// time and lives only on this function's stack frame. For Pro/Max
// subscription auth a separate `subscription-auth.ts` flow runs — that
// path never lets plaintext tokens reach the renderer (see ADR-0004).
//
// Streaming uses anthropic's SSE format with named events:
//   message_start → content_block_start → content_block_delta (text_delta
//   or input_json_delta) → content_block_stop → message_delta (with
//   stop_reason + usage) → message_stop.

import { sseFromResponse } from "./sse";
import type { CallOptions, ChatChunk, ProviderAdapter } from "./types";

const DEFAULT_BASE = "https://api.anthropic.com";
const API_VERSION = "2023-06-01";

interface AnthropicContentBlockText {
  type: "text";
  text: string;
}
interface AnthropicContentBlockToolUse {
  type: "tool_use";
  id: string;
  name: string;
  input: unknown;
}
type AnthropicContentBlock = AnthropicContentBlockText | AnthropicContentBlockToolUse;

interface AnthropicResponseJson {
  content: AnthropicContentBlock[];
  stop_reason: string | null;
  usage: { input_tokens: number; output_tokens: number };
}

function buildRequestBody(opts: CallOptions, stream: boolean): unknown {
  const system = opts.messages.find((m) => m.role === "system")?.content;
  const messages = opts.messages
    .filter((m) => m.role !== "system")
    .map((m) => ({
      role: m.role === "tool" ? "user" : m.role,
      content: m.content,
    }));
  const body: Record<string, unknown> = {
    model: opts.model,
    messages,
    max_tokens: opts.maxTokens ?? 4096,
    stream,
  };
  if (system) body.system = system;
  if (opts.temperature !== undefined) body.temperature = opts.temperature;
  if (opts.tools && opts.tools.length > 0) {
    body.tools = opts.tools.map((t) => ({
      name: t.name,
      description: t.description ?? "",
      input_schema: t.parameters,
    }));
  }
  return body;
}

async function* callStreaming(opts: CallOptions): AsyncGenerator<ChatChunk, void, void> {
  const base = (opts.baseUrl ?? DEFAULT_BASE).replace(/\/$/, "");
  const res = await fetch(`${base}/v1/messages`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-api-key": opts.apiKey,
      "anthropic-version": API_VERSION,
      "accept": "text/event-stream",
    },
    body: JSON.stringify(buildRequestBody(opts, true)),
    ...(opts.signal ? { signal: opts.signal } : {}),
  });
  if (!res.ok) {
    const errText = await res.text().catch(() => "");
    yield { kind: "error", message: `anthropic ${res.status}: ${errText || res.statusText}` };
    return;
  }
  let inputTokens = 0;
  let outputTokens = 0;
  let stopReason = "stop";
  const toolBufs = new Map<number, { id: string; name: string; argsJson: string }>();
  for await (const ev of sseFromResponse(res, opts.signal)) {
    if (!ev.data || ev.data === "[DONE]") continue;
    let parsed: Record<string, unknown>;
    try {
      parsed = JSON.parse(ev.data) as Record<string, unknown>;
    } catch {
      continue;
    }
    const type = parsed.type as string | undefined;
    if (type === "message_start") {
      const usage = ((parsed.message as Record<string, unknown> | undefined)?.usage ?? {}) as {
        input_tokens?: number;
        output_tokens?: number;
      };
      inputTokens = usage.input_tokens ?? 0;
      outputTokens = usage.output_tokens ?? 0;
    } else if (type === "content_block_start") {
      const idx = parsed.index as number;
      const block = parsed.content_block as Record<string, unknown> | undefined;
      if (block?.type === "tool_use") {
        toolBufs.set(idx, {
          id: String(block.id ?? ""),
          name: String(block.name ?? ""),
          argsJson: "",
        });
      }
    } else if (type === "content_block_delta") {
      const idx = parsed.index as number;
      const delta = parsed.delta as Record<string, unknown> | undefined;
      if (delta?.type === "text_delta") {
        yield { kind: "text", delta: String(delta.text ?? "") };
      } else if (delta?.type === "input_json_delta") {
        const buf = toolBufs.get(idx);
        if (buf) buf.argsJson += String(delta.partial_json ?? "");
      }
    } else if (type === "content_block_stop") {
      const idx = parsed.index as number;
      const buf = toolBufs.get(idx);
      if (buf) {
        yield { kind: "tool-call", id: buf.id, name: buf.name, argsJson: buf.argsJson };
        toolBufs.delete(idx);
      }
    } else if (type === "message_delta") {
      const delta = parsed.delta as Record<string, unknown> | undefined;
      const usage = parsed.usage as { output_tokens?: number } | undefined;
      if (delta?.stop_reason) stopReason = String(delta.stop_reason);
      if (usage?.output_tokens !== undefined) outputTokens = usage.output_tokens;
    }
  }
  yield {
    kind: "done",
    usage: { inputTokens, outputTokens },
    finishReason: stopReason,
  };
}

async function* callOneShot(opts: CallOptions): AsyncGenerator<ChatChunk, void, void> {
  const base = (opts.baseUrl ?? DEFAULT_BASE).replace(/\/$/, "");
  const res = await fetch(`${base}/v1/messages`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-api-key": opts.apiKey,
      "anthropic-version": API_VERSION,
    },
    body: JSON.stringify(buildRequestBody(opts, false)),
    ...(opts.signal ? { signal: opts.signal } : {}),
  });
  if (!res.ok) {
    const errText = await res.text().catch(() => "");
    yield { kind: "error", message: `anthropic ${res.status}: ${errText || res.statusText}` };
    return;
  }
  const body = (await res.json()) as AnthropicResponseJson;
  for (const block of body.content ?? []) {
    if (block.type === "text") {
      yield { kind: "text", delta: block.text };
    } else if (block.type === "tool_use") {
      yield {
        kind: "tool-call",
        id: block.id,
        name: block.name,
        argsJson: JSON.stringify(block.input ?? {}),
      };
    }
  }
  yield {
    kind: "done",
    usage: {
      inputTokens: body.usage?.input_tokens ?? 0,
      outputTokens: body.usage?.output_tokens ?? 0,
    },
    finishReason: body.stop_reason ?? "stop",
  };
}

export const anthropicAdapter: ProviderAdapter = {
  call(opts) {
    return opts.stream ? callStreaming(opts) : callOneShot(opts);
  },
};
