// T-U13-001-FIX-C: provider router + usage accounting.
//
// `runChat({ alias, messages, … })` is the single entry point used by
// every action runner (review, translate, summarize, …). It:
//
//   1. Looks up the AiKeyEntry for the alias to learn provider/model/baseUrl.
//   2. Resolves the plaintext key for the *duration of the request only*
//      via `invoke('ai_key_resolve')`. The string lives on this function's
//      stack frame and is dropped when the adapter call returns. Ollama
//      and subscription-mode aliases skip the resolve entirely.
//   3. Picks the matching adapter (Anthropic native vs. OpenAI-compat for
//      everything else — DeepSeek/Mistral/xAI/Ollama all speak the same
//      wire format with different baseUrls).
//   4. Streams chunks back to the caller while accumulating token totals.
//   5. On completion (or error / abort) writes one row via `recordUsage`
//      so the cost dashboard (S-AIC-006/007) is always up to date.

import { invoke } from "@tauri-apps/api/core";
import { useKeyStore } from "./key-store";
import { OLLAMA_DEFAULT_BASE_URL } from "./ollama";
import type { ProviderId } from "./providers";
import { anthropicAdapter } from "./providers/anthropic";
import { openaiAdapter } from "./providers/openai";
import type {
  CallOptions,
  ChatChunk,
  ChatMessage,
  ProviderAdapter,
  ToolSpec,
} from "./providers/types";
import { BUILTIN_PRICING, type UsageRow, computeUsd, recordUsage } from "./usage";

export interface RunChatInput {
  alias: string;
  /** Action id from `actions.ts` — recorded with the usage row. */
  actionId: string;
  messages: ChatMessage[];
  tools?: ToolSpec[];
  stream?: boolean;
  signal?: AbortSignal;
  temperature?: number;
  maxTokens?: number;
  /** Override the alias's stored model (rare — used by Review). */
  modelOverride?: string;
}

export interface RunChatResult {
  /** Concatenated text-delta chunks. */
  text: string;
  /** Tool-call chunks, in arrival order. */
  toolCalls: { id: string; name: string; argsJson: string }[];
  finishReason: string;
  inputTokens: number;
  outputTokens: number;
  usd: number;
  /** "ok" if the stream completed cleanly, "aborted" if the signal fired,
   *  "error" if the adapter yielded an error chunk. */
  status: UsageRow["status"];
  errorMessage?: string;
}

function adapterFor(provider: ProviderId): ProviderAdapter {
  // Anthropic uses its own Messages API. Every other listed provider
  // (openai, google via openai-compat path, xai, deepseek, mistral,
  // ollama, openai-compatible) speaks chat-completions.
  if (provider === "anthropic") return anthropicAdapter;
  return openaiAdapter;
}

function baseUrlFor(provider: ProviderId, storedBaseUrl: string | null): string | undefined {
  if (storedBaseUrl) {
    if (provider === "ollama") return `${storedBaseUrl.replace(/\/$/, "")}/v1`;
    return storedBaseUrl;
  }
  if (provider === "ollama") return `${OLLAMA_DEFAULT_BASE_URL}/v1`;
  return undefined;
}

async function resolveApiKey(provider: ProviderId, alias: string): Promise<string> {
  // Ollama is local and key-less; the openai adapter still expects a
  // Bearer header, so we send a placeholder. Local servers ignore it.
  if (provider === "ollama") return "ollama";
  try {
    return await invoke<string>("ai_key_resolve", { alias });
  } catch (e) {
    throw new Error(`failed to resolve key for "${alias}": ${String(e)}`);
  }
}

export async function* runChatStream(
  input: RunChatInput,
): AsyncGenerator<ChatChunk, RunChatResult, void> {
  const entry = useKeyStore.getState().entries.find((e) => e.alias === input.alias);
  if (!entry) {
    const err: ChatChunk = { kind: "error", message: `unknown alias: ${input.alias}` };
    yield err;
    return {
      text: "",
      toolCalls: [],
      finishReason: "error",
      inputTokens: 0,
      outputTokens: 0,
      usd: 0,
      status: "error",
      errorMessage: err.message,
    };
  }
  const model = input.modelOverride ?? entry.model;
  const apiKey = await resolveApiKey(entry.provider, entry.alias);
  const callOpts: CallOptions = {
    apiKey,
    model,
    messages: input.messages,
    stream: input.stream ?? true,
    ...(input.tools ? { tools: input.tools } : {}),
    ...(input.signal ? { signal: input.signal } : {}),
    ...(input.temperature !== undefined ? { temperature: input.temperature } : {}),
    ...(input.maxTokens !== undefined ? { maxTokens: input.maxTokens } : {}),
  };
  const base = baseUrlFor(entry.provider, entry.baseUrl);
  if (base) callOpts.baseUrl = base;
  const adapter = adapterFor(entry.provider);
  const result: RunChatResult = {
    text: "",
    toolCalls: [],
    finishReason: "stop",
    inputTokens: 0,
    outputTokens: 0,
    usd: 0,
    status: "ok",
  };
  try {
    for await (const chunk of adapter.call(callOpts)) {
      if (chunk.kind === "text") {
        result.text += chunk.delta;
      } else if (chunk.kind === "tool-call") {
        result.toolCalls.push({ id: chunk.id, name: chunk.name, argsJson: chunk.argsJson });
      } else if (chunk.kind === "done") {
        result.inputTokens = chunk.usage.inputTokens;
        result.outputTokens = chunk.usage.outputTokens;
        result.finishReason = chunk.finishReason;
      } else if (chunk.kind === "error") {
        result.status = "error";
        result.errorMessage = chunk.message;
      }
      yield chunk;
    }
  } catch (e) {
    if (input.signal?.aborted) {
      result.status = "aborted";
    } else {
      result.status = "error";
      result.errorMessage = e instanceof Error ? e.message : String(e);
      yield { kind: "error", message: result.errorMessage };
    }
  }
  result.usd = computeUsd(
    BUILTIN_PRICING,
    entry.provider,
    model,
    result.inputTokens,
    result.outputTokens,
  );
  // Record one row per call regardless of outcome — cost dashboards need
  // to see the partial tokens streamed before an abort, and error rows
  // help diagnose recurring failures.
  void recordUsage({
    ts: Date.now(),
    alias: entry.alias,
    provider: entry.provider,
    model,
    actionId: input.actionId,
    inputTokens: result.inputTokens,
    outputTokens: result.outputTokens,
    usd: result.usd,
    pricingVersion: BUILTIN_PRICING.version,
    status: result.status,
  }).catch((err) => {
    console.warn("[ai/runner] recordUsage failed", err);
  });
  return result;
}

/**
 * Non-streaming convenience wrapper: collects every chunk and resolves
 * with the final RunChatResult. The generator's return value carries the
 * accounting; we surface it here so callers that don't iterate chunks
 * directly can still read tokens/usd.
 */
export async function runChat(input: RunChatInput): Promise<RunChatResult> {
  const iter = runChatStream({ ...input, stream: input.stream ?? false });
  let result: RunChatResult | undefined;
  while (true) {
    const step = await iter.next();
    if (step.done) {
      result = step.value;
      break;
    }
  }
  return (
    result ?? {
      text: "",
      toolCalls: [],
      finishReason: "error",
      inputTokens: 0,
      outputTokens: 0,
      usd: 0,
      status: "error",
      errorMessage: "runner returned no result",
    }
  );
}
