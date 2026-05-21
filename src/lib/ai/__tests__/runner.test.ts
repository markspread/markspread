// T-U13-001-FIX-C: runChat / runChatStream coverage.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const invoke = vi.fn<(cmd: string, args?: unknown) => Promise<unknown>>();
vi.mock("@tauri-apps/api/core", () => ({
  invoke: (cmd: string, args?: unknown) => invoke(cmd, args),
}));

const recordUsage = vi.fn<typeof import("../usage").recordUsage>(() => Promise.resolve());
vi.mock("../usage", async () => {
  const actual = await vi.importActual<typeof import("../usage")>("../usage");
  return {
    ...actual,
    recordUsage: (...args: Parameters<typeof import("../usage").recordUsage>) =>
      recordUsage(...args),
  };
});

const anthropicCall = vi.fn();
vi.mock("../providers/anthropic", () => ({
  anthropicAdapter: {
    call: (opts: unknown) => anthropicCall(opts),
  },
}));

const openaiCall = vi.fn();
vi.mock("../providers/openai", () => ({
  openaiAdapter: {
    call: (opts: unknown) => openaiCall(opts),
  },
}));

import type { AiKeyEntry } from "../key-store";
import { useKeyStore } from "../key-store";
import type { ChatChunk } from "../providers/types";
import { runChat, runChatStream } from "../runner";

const entry: AiKeyEntry = {
  alias: "default",
  provider: "anthropic",
  model: "claude-opus-4-7",
  baseUrl: null,
  maskedKey: "sk-…••••XYZ",
  createdAt: 0,
};

async function* iter(chunks: ChatChunk[]): AsyncGenerator<ChatChunk, void, void> {
  for (const c of chunks) yield c;
}

async function collect(
  gen: AsyncGenerator<ChatChunk, unknown, void>,
): Promise<{ chunks: ChatChunk[]; result: unknown }> {
  const chunks: ChatChunk[] = [];
  while (true) {
    const step = await gen.next();
    if (step.done) return { chunks, result: step.value };
    chunks.push(step.value);
  }
}

beforeEach(() => {
  useKeyStore.setState({ entries: [entry], defaultAlias: "default" });
  invoke.mockReset();
  recordUsage.mockClear();
  anthropicCall.mockReset();
  openaiCall.mockReset();
});

afterEach(() => {
  useKeyStore.setState({ entries: [], defaultAlias: null });
});

describe("runChatStream", () => {
  it("yields a single error chunk for an unknown alias", async () => {
    const { chunks, result } = await collect(
      runChatStream({ alias: "missing", actionId: "x", messages: [] }),
    );
    expect(chunks).toEqual([{ kind: "error", message: "unknown alias: missing" }]);
    expect(result).toMatchObject({
      status: "error",
      errorMessage: "unknown alias: missing",
      text: "",
    });
    expect(recordUsage).not.toHaveBeenCalled();
  });

  it("routes to the anthropic adapter and records usage", async () => {
    invoke.mockResolvedValueOnce("sk-anthropic");
    anthropicCall.mockReturnValueOnce(
      iter([
        { kind: "text", delta: "Hello " },
        { kind: "text", delta: "world" },
        { kind: "tool-call", id: "t", name: "search", argsJson: "{}" },
        {
          kind: "done",
          usage: { inputTokens: 4, outputTokens: 11 },
          finishReason: "end_turn",
        },
      ]),
    );
    const { chunks, result } = await collect(
      runChatStream({
        alias: "default",
        actionId: "review",
        messages: [{ role: "user", content: "hi" }],
        temperature: 0.1,
        maxTokens: 64,
        tools: [{ name: "noop", parameters: {} }],
      }),
    );
    expect(chunks).toHaveLength(4);
    expect(result).toMatchObject({
      text: "Hello world",
      toolCalls: [{ id: "t", name: "search", argsJson: "{}" }],
      finishReason: "end_turn",
      inputTokens: 4,
      outputTokens: 11,
      status: "ok",
    });
    const callArg = anthropicCall.mock.calls[0]?.[0] as {
      apiKey: string;
      stream: boolean;
      temperature: number;
      maxTokens: number;
      tools: unknown[];
    };
    expect(callArg.apiKey).toBe("sk-anthropic");
    expect(callArg.stream).toBe(true);
    expect(callArg.tools).toHaveLength(1);
    expect(recordUsage).toHaveBeenCalledTimes(1);
    const row = (recordUsage.mock.calls[0] as unknown as [{ actionId: string; status: string }])[0];
    expect(row.actionId).toBe("review");
    expect(row.status).toBe("ok");
  });

  it("uses the openai adapter for non-anthropic providers and the ollama base url", async () => {
    useKeyStore.setState({
      entries: [{ ...entry, provider: "ollama", baseUrl: null }],
    });
    openaiCall.mockReturnValueOnce(
      iter([
        {
          kind: "done",
          usage: { inputTokens: 1, outputTokens: 2 },
          finishReason: "stop",
        },
      ]),
    );
    await collect(runChatStream({ alias: "default", actionId: "x", messages: [] }));
    const opts = openaiCall.mock.calls[0]?.[0] as { apiKey: string; baseUrl: string };
    expect(opts.apiKey).toBe("ollama");
    expect(opts.baseUrl).toBe("http://127.0.0.1:11434/v1");
    expect(invoke).not.toHaveBeenCalled();
  });

  it("honours a stored ollama baseUrl override", async () => {
    useKeyStore.setState({
      entries: [{ ...entry, provider: "ollama", baseUrl: "http://gw:9999/" }],
    });
    openaiCall.mockReturnValueOnce(
      iter([
        {
          kind: "done",
          usage: { inputTokens: 0, outputTokens: 0 },
          finishReason: "stop",
        },
      ]),
    );
    await collect(runChatStream({ alias: "default", actionId: "x", messages: [] }));
    const opts = openaiCall.mock.calls[0]?.[0] as { baseUrl: string };
    expect(opts.baseUrl).toBe("http://gw:9999/v1");
  });

  it("passes through a stored baseUrl untouched for non-ollama providers", async () => {
    useKeyStore.setState({
      entries: [{ ...entry, provider: "openai", baseUrl: "https://proxy.example/v1" }],
    });
    invoke.mockResolvedValueOnce("sk-openai");
    openaiCall.mockReturnValueOnce(
      iter([
        {
          kind: "done",
          usage: { inputTokens: 0, outputTokens: 0 },
          finishReason: "stop",
        },
      ]),
    );
    await collect(runChatStream({ alias: "default", actionId: "x", messages: [] }));
    const opts = openaiCall.mock.calls[0]?.[0] as { baseUrl: string };
    expect(opts.baseUrl).toBe("https://proxy.example/v1");
  });

  it("honours modelOverride and forwards the abort signal", async () => {
    invoke.mockResolvedValueOnce("sk-anthropic");
    anthropicCall.mockReturnValueOnce(
      iter([
        {
          kind: "done",
          usage: { inputTokens: 0, outputTokens: 0 },
          finishReason: "stop",
        },
      ]),
    );
    const ctrl = new AbortController();
    await collect(
      runChatStream({
        alias: "default",
        actionId: "x",
        messages: [],
        modelOverride: "claude-3-5-haiku",
        signal: ctrl.signal,
      }),
    );
    const opts = anthropicCall.mock.calls[0]?.[0] as { model: string; signal: AbortSignal };
    expect(opts.model).toBe("claude-3-5-haiku");
    expect(opts.signal).toBe(ctrl.signal);
  });

  it("propagates an adapter error chunk into the result status", async () => {
    invoke.mockResolvedValueOnce("sk-anthropic");
    anthropicCall.mockReturnValueOnce(
      iter([
        { kind: "error", message: "boom" },
        {
          kind: "done",
          usage: { inputTokens: 0, outputTokens: 0 },
          finishReason: "stop",
        },
      ]),
    );
    const { result } = await collect(
      runChatStream({ alias: "default", actionId: "x", messages: [] }),
    );
    expect(result).toMatchObject({ status: "error", errorMessage: "boom" });
  });

  it("treats a throw with an aborted signal as 'aborted'", async () => {
    invoke.mockResolvedValueOnce("sk-anthropic");
    const ctrl = new AbortController();
    anthropicCall.mockImplementationOnce(
      // biome-ignore lint/correctness/useYield: aborting generator throws before any yield is reachable — that's the production code path we're exercising.
      async function* (): AsyncGenerator<ChatChunk> {
        ctrl.abort();
        throw new Error("aborted upstream");
      },
    );
    const { chunks, result } = await collect(
      runChatStream({ alias: "default", actionId: "x", messages: [], signal: ctrl.signal }),
    );
    expect(chunks).toEqual([]);
    expect(result).toMatchObject({ status: "aborted" });
  });

  it("yields an error chunk for an unexpected throw without an abort", async () => {
    invoke.mockResolvedValueOnce("sk-anthropic");
    anthropicCall.mockImplementationOnce(
      // biome-ignore lint/correctness/useYield: error-before-yield is the production path we're exercising.
      async function* (): AsyncGenerator<ChatChunk> {
        throw new Error("network");
      },
    );
    const { chunks, result } = await collect(
      runChatStream({ alias: "default", actionId: "x", messages: [] }),
    );
    expect(chunks).toEqual([{ kind: "error", message: "network" }]);
    expect(result).toMatchObject({ status: "error", errorMessage: "network" });
  });

  it("stringifies non-Error throws in the error path", async () => {
    invoke.mockResolvedValueOnce("sk-anthropic");
    anthropicCall.mockImplementationOnce(
      // biome-ignore lint/correctness/useYield: error-before-yield is the production path we're exercising.
      async function* (): AsyncGenerator<ChatChunk> {
        throw "kaboom";
      },
    );
    const { result } = await collect(
      runChatStream({ alias: "default", actionId: "x", messages: [] }),
    );
    expect(result).toMatchObject({ status: "error", errorMessage: "kaboom" });
  });

  it("wraps an ai_key_resolve failure in a clear message", async () => {
    invoke.mockRejectedValueOnce(new Error("denied"));
    await expect(
      collect(runChatStream({ alias: "default", actionId: "x", messages: [] })),
    ).rejects.toThrow(/failed to resolve key for "default"/);
  });

  it("logs but does not throw when recordUsage rejects", async () => {
    invoke.mockResolvedValueOnce("sk-anthropic");
    anthropicCall.mockReturnValueOnce(
      iter([
        {
          kind: "done",
          usage: { inputTokens: 0, outputTokens: 0 },
          finishReason: "stop",
        },
      ]),
    );
    recordUsage.mockImplementationOnce(() => Promise.reject(new Error("disk full")));
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    await collect(runChatStream({ alias: "default", actionId: "x", messages: [] }));
    // Let the .catch microtask drain.
    await Promise.resolve();
    await Promise.resolve();
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });
});

describe("runChat", () => {
  it("collects all chunks and resolves with the RunChatResult", async () => {
    invoke.mockResolvedValueOnce("sk-anthropic");
    anthropicCall.mockReturnValueOnce(
      iter([
        { kind: "text", delta: "ok" },
        {
          kind: "done",
          usage: { inputTokens: 1, outputTokens: 2 },
          finishReason: "stop",
        },
      ]),
    );
    const r = await runChat({ alias: "default", actionId: "x", messages: [] });
    expect(r.text).toBe("ok");
    expect(r.inputTokens).toBe(1);
    expect(r.outputTokens).toBe(2);
    const opts = anthropicCall.mock.calls[0]?.[0] as { stream: boolean };
    expect(opts.stream).toBe(false);
  });
});
