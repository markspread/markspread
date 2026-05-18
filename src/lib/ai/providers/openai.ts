// T-U13-001-FIX-B: OpenAI Chat Completions adapter.
//
// Used for OpenAI proper and for any provider exposing the same wire
// format (Azure-OpenAI, vLLM, LM Studio, OpenRouter, Together, Mistral
// in OpenAI-compat mode, DeepSeek). Per-provider baseUrl + auth scheme
// is resolved by runner.ts before reaching this adapter.
//
// Streaming uses the `data: { … }\n\n` SSE flavour with a terminator
// `data: [DONE]`. tool calls arrive as a `tool_calls` array on the
// delta with id/name set on the first chunk and `arguments` accumulated
// across subsequent chunks.

import { sseFromResponse } from "./sse";
import type { CallOptions, ChatChunk, ProviderAdapter } from "./types";

const DEFAULT_BASE = "https://api.openai.com/v1";

function buildRequestBody(opts: CallOptions, stream: boolean): unknown {
  const body: Record<string, unknown> = {
    model: opts.model,
    messages: opts.messages.map((m) => ({
      role: m.role,
      content: m.content,
      ...(m.name ? { name: m.name } : {}),
    })),
    stream,
  };
  if (stream) body.stream_options = { include_usage: true };
  if (opts.temperature !== undefined) body.temperature = opts.temperature;
  if (opts.maxTokens !== undefined) body.max_tokens = opts.maxTokens;
  if (opts.tools && opts.tools.length > 0) {
    body.tools = opts.tools.map((t) => ({
      type: "function",
      function: {
        name: t.name,
        description: t.description ?? "",
        parameters: t.parameters,
      },
    }));
  }
  return body;
}

interface OpenAIChoiceMessage {
  content?: string | null;
  tool_calls?: { id: string; function: { name: string; arguments: string } }[];
}
interface OpenAIResponseJson {
  choices: { message: OpenAIChoiceMessage; finish_reason: string | null }[];
  usage?: { prompt_tokens: number; completion_tokens: number };
}

async function* callStreaming(opts: CallOptions): AsyncGenerator<ChatChunk, void, void> {
  const base = (opts.baseUrl ?? DEFAULT_BASE).replace(/\/$/, "");
  const res = await fetch(`${base}/chat/completions`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${opts.apiKey}`,
      accept: "text/event-stream",
    },
    body: JSON.stringify(buildRequestBody(opts, true)),
    ...(opts.signal ? { signal: opts.signal } : {}),
  });
  if (!res.ok) {
    const errText = await res.text().catch(() => "");
    yield { kind: "error", message: `openai ${res.status}: ${errText || res.statusText}` };
    return;
  }
  let inputTokens = 0;
  let outputTokens = 0;
  let finishReason = "stop";
  const toolBufs = new Map<number, { id: string; name: string; argsJson: string }>();
  for await (const ev of sseFromResponse(res, opts.signal)) {
    if (!ev.data || ev.data === "[DONE]") continue;
    let parsed: Record<string, unknown>;
    try {
      parsed = JSON.parse(ev.data) as Record<string, unknown>;
    } catch {
      continue;
    }
    const choices = parsed.choices as
      | { delta?: Record<string, unknown>; finish_reason?: string | null }[]
      | undefined;
    const choice = choices?.[0];
    const usage = parsed.usage as
      | { prompt_tokens?: number; completion_tokens?: number }
      | undefined;
    if (usage) {
      inputTokens = usage.prompt_tokens ?? inputTokens;
      outputTokens = usage.completion_tokens ?? outputTokens;
    }
    if (!choice) continue;
    const delta = choice.delta;
    if (delta) {
      const content = delta.content as string | undefined;
      if (content) yield { kind: "text", delta: content };
      const toolCalls = delta.tool_calls as
        | { index: number; id?: string; function?: { name?: string; arguments?: string } }[]
        | undefined;
      if (toolCalls) {
        for (const tc of toolCalls) {
          const cur = toolBufs.get(tc.index) ?? { id: "", name: "", argsJson: "" };
          if (tc.id) cur.id = tc.id;
          if (tc.function?.name) cur.name = tc.function.name;
          if (tc.function?.arguments) cur.argsJson += tc.function.arguments;
          toolBufs.set(tc.index, cur);
        }
      }
    }
    if (choice.finish_reason) {
      finishReason = choice.finish_reason;
    }
  }
  for (const buf of toolBufs.values()) {
    yield { kind: "tool-call", id: buf.id, name: buf.name, argsJson: buf.argsJson };
  }
  yield { kind: "done", usage: { inputTokens, outputTokens }, finishReason };
}

async function* callOneShot(opts: CallOptions): AsyncGenerator<ChatChunk, void, void> {
  const base = (opts.baseUrl ?? DEFAULT_BASE).replace(/\/$/, "");
  const res = await fetch(`${base}/chat/completions`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${opts.apiKey}`,
    },
    body: JSON.stringify(buildRequestBody(opts, false)),
    ...(opts.signal ? { signal: opts.signal } : {}),
  });
  if (!res.ok) {
    const errText = await res.text().catch(() => "");
    yield { kind: "error", message: `openai ${res.status}: ${errText || res.statusText}` };
    return;
  }
  const body = (await res.json()) as OpenAIResponseJson;
  const choice = body.choices?.[0];
  if (choice?.message?.content) {
    yield { kind: "text", delta: choice.message.content };
  }
  for (const tc of choice?.message?.tool_calls ?? []) {
    yield {
      kind: "tool-call",
      id: tc.id,
      name: tc.function.name,
      argsJson: tc.function.arguments,
    };
  }
  yield {
    kind: "done",
    usage: {
      inputTokens: body.usage?.prompt_tokens ?? 0,
      outputTokens: body.usage?.completion_tokens ?? 0,
    },
    finishReason: choice?.finish_reason ?? "stop",
  };
}

export const openaiAdapter: ProviderAdapter = {
  call(opts) {
    return opts.stream ? callStreaming(opts) : callOneShot(opts);
  },
};
