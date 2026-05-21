// T-U13-001-FIX-A: Anthropic adapter coverage.

import { afterEach, describe, expect, it, vi } from "vitest";
import { anthropicAdapter } from "../providers/anthropic";
import type { CallOptions, ChatChunk } from "../providers/types";

const originalFetch = globalThis.fetch;

function streamingResponse(lines: string[]): Response {
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      const enc = new TextEncoder();
      for (const l of lines) controller.enqueue(enc.encode(l));
      controller.close();
    },
  });
  return new Response(stream, { status: 200 });
}

async function collect(iter: AsyncIterable<ChatChunk>): Promise<ChatChunk[]> {
  const out: ChatChunk[] = [];
  for await (const c of iter) out.push(c);
  return out;
}

const baseOpts: CallOptions = {
  apiKey: "sk-test",
  model: "claude-opus-4-7",
  messages: [{ role: "user", content: "hi" }],
};

afterEach(() => {
  globalThis.fetch = originalFetch;
  vi.restoreAllMocks();
});

describe("anthropicAdapter streaming", () => {
  it("parses message_start, text deltas, tool calls and usage", async () => {
    const fetchMock = vi.fn(() =>
      Promise.resolve(
        streamingResponse([
          `data: ${JSON.stringify({ type: "message_start", message: { usage: { input_tokens: 5, output_tokens: 0 } } })}\n\n`,
          `data: ${JSON.stringify({ type: "content_block_start", index: 0, content_block: { type: "text" } })}\n\n`,
          `data: ${JSON.stringify({ type: "content_block_delta", index: 0, delta: { type: "text_delta", text: "Hello " } })}\n\n`,
          `data: ${JSON.stringify({ type: "content_block_delta", index: 0, delta: { type: "text_delta", text: "world" } })}\n\n`,
          `data: ${JSON.stringify({ type: "content_block_stop", index: 0 })}\n\n`,
          `data: ${JSON.stringify({ type: "content_block_start", index: 1, content_block: { type: "tool_use", id: "tu_1", name: "search" } })}\n\n`,
          `data: ${JSON.stringify({ type: "content_block_delta", index: 1, delta: { type: "input_json_delta", partial_json: '{"q":' } })}\n\n`,
          `data: ${JSON.stringify({ type: "content_block_delta", index: 1, delta: { type: "input_json_delta", partial_json: '"hi"}' } })}\n\n`,
          `data: ${JSON.stringify({ type: "content_block_stop", index: 1 })}\n\n`,
          `data: ${JSON.stringify({ type: "message_delta", delta: { stop_reason: "end_turn" }, usage: { output_tokens: 12 } })}\n\n`,
          `data: ${JSON.stringify({ type: "message_stop" })}\n\n`,
        ]),
      ),
    );
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    const chunks = await collect(
      anthropicAdapter.call({
        ...baseOpts,
        stream: true,
        temperature: 0.5,
        maxTokens: 256,
        tools: [{ name: "search", parameters: { type: "object" } }],
        messages: [
          { role: "system", content: "be brief" },
          { role: "user", content: "hi" },
          { role: "tool", content: '{"r":1}', name: "search" },
        ],
      }),
    );

    expect(chunks).toEqual([
      { kind: "text", delta: "Hello " },
      { kind: "text", delta: "world" },
      { kind: "tool-call", id: "tu_1", name: "search", argsJson: '{"q":"hi"}' },
      { kind: "done", usage: { inputTokens: 5, outputTokens: 12 }, finishReason: "end_turn" },
    ]);
    const [url, init] = (fetchMock.mock.calls[0] ?? []) as unknown as [string, RequestInit];
    expect(url).toBe("https://api.anthropic.com/v1/messages");
    expect(init.headers).toMatchObject({
      "x-api-key": "sk-test",
      "anthropic-version": "2023-06-01",
    });
    const body = JSON.parse(init.body as string) as Record<string, unknown>;
    expect(body).toMatchObject({
      model: "claude-opus-4-7",
      stream: true,
      system: "be brief",
      temperature: 0.5,
      max_tokens: 256,
    });
    expect((body.messages as Array<{ role: string }>)[1]?.role).toBe("user");
    expect((body.tools as Array<{ name: string }>)[0]?.name).toBe("search");
  });

  it("strips trailing slash from baseUrl override and forwards the abort signal", async () => {
    const fetchMock = vi.fn(() => Promise.resolve(streamingResponse([])));
    globalThis.fetch = fetchMock as unknown as typeof fetch;
    const ctrl = new AbortController();
    await collect(
      anthropicAdapter.call({
        ...baseOpts,
        stream: true,
        baseUrl: "https://proxy.example/",
        signal: ctrl.signal,
      }),
    );
    const [url, init] = (fetchMock.mock.calls[0] ?? []) as unknown as [string, RequestInit];
    expect(url).toBe("https://proxy.example/v1/messages");
    expect(init.signal).toBe(ctrl.signal);
  });

  it("yields an error chunk when the streaming response is not ok", async () => {
    globalThis.fetch = vi.fn(() =>
      Promise.resolve(new Response("rate limited", { status: 429, statusText: "Too Many" })),
    ) as unknown as typeof fetch;
    const chunks = await collect(anthropicAdapter.call({ ...baseOpts, stream: true }));
    expect(chunks).toEqual([{ kind: "error", message: "anthropic 429: rate limited" }]);
  });

  it("falls back to statusText when the error body cannot be read", async () => {
    const failingBody = new ReadableStream<Uint8Array>({
      start(c) {
        c.error(new Error("boom"));
      },
    });
    globalThis.fetch = vi.fn(() =>
      Promise.resolve(new Response(failingBody, { status: 500, statusText: "Server" })),
    ) as unknown as typeof fetch;
    const chunks = await collect(anthropicAdapter.call({ ...baseOpts, stream: true }));
    expect(chunks).toEqual([{ kind: "error", message: "anthropic 500: Server" }]);
  });

  it("falls back to empty strings for missing tool ids/names and delta fields", async () => {
    globalThis.fetch = vi.fn(() =>
      Promise.resolve(
        streamingResponse([
          `data: ${JSON.stringify({ type: "content_block_start", index: 0, content_block: { type: "tool_use" } })}\n\n`,
          `data: ${JSON.stringify({ type: "content_block_delta", index: 0, delta: { type: "input_json_delta" } })}\n\n`,
          `data: ${JSON.stringify({ type: "content_block_delta", index: 1, delta: { type: "text_delta" } })}\n\n`,
          `data: ${JSON.stringify({ type: "content_block_stop", index: 0 })}\n\n`,
        ]),
      ),
    ) as unknown as typeof fetch;
    const chunks = await collect(anthropicAdapter.call({ ...baseOpts, stream: true }));
    expect(chunks).toEqual([
      { kind: "text", delta: "" },
      { kind: "tool-call", id: "", name: "", argsJson: "" },
      { kind: "done", usage: { inputTokens: 0, outputTokens: 0 }, finishReason: "stop" },
    ]);
  });

  it("ignores malformed SSE payloads, [DONE] markers and empty data", async () => {
    globalThis.fetch = vi.fn(() =>
      Promise.resolve(
        streamingResponse([
          "data: \n\n",
          "data: [DONE]\n\n",
          "data: not-json\n\n",
          `data: ${JSON.stringify({ type: "unknown_event" })}\n\n`,
          `data: ${JSON.stringify({ type: "message_start", message: {} })}\n\n`,
          `data: ${JSON.stringify({ type: "content_block_delta", index: 0, delta: { type: "input_json_delta", partial_json: "{}" } })}\n\n`,
          `data: ${JSON.stringify({ type: "content_block_stop", index: 0 })}\n\n`,
          `data: ${JSON.stringify({ type: "message_delta", delta: {}, usage: {} })}\n\n`,
        ]),
      ),
    ) as unknown as typeof fetch;
    const chunks = await collect(anthropicAdapter.call({ ...baseOpts, stream: true }));
    expect(chunks).toEqual([
      { kind: "done", usage: { inputTokens: 0, outputTokens: 0 }, finishReason: "stop" },
    ]);
  });
});

describe("anthropicAdapter one-shot", () => {
  it("emits text + tool-call blocks and a done chunk", async () => {
    const body = {
      content: [
        { type: "text", text: "Hi there" },
        { type: "tool_use", id: "tu_2", name: "search", input: { q: "hello" } },
      ],
      stop_reason: "end_turn",
      usage: { input_tokens: 7, output_tokens: 9 },
    };
    const fetchMock = vi.fn(() =>
      Promise.resolve(new Response(JSON.stringify(body), { status: 200 })),
    );
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    const chunks = await collect(anthropicAdapter.call({ ...baseOpts }));
    expect(chunks).toEqual([
      { kind: "text", delta: "Hi there" },
      { kind: "tool-call", id: "tu_2", name: "search", argsJson: '{"q":"hello"}' },
      { kind: "done", usage: { inputTokens: 7, outputTokens: 9 }, finishReason: "end_turn" },
    ]);
    const init = (fetchMock.mock.calls[0] as unknown as [string, RequestInit])[1];
    const reqBody = JSON.parse(init.body as string) as Record<string, unknown>;
    expect(reqBody.stream).toBe(false);
    expect(reqBody.max_tokens).toBe(4096);
  });

  it("defaults missing content/usage/stop_reason to safe values", async () => {
    globalThis.fetch = vi.fn(() =>
      Promise.resolve(new Response(JSON.stringify({}), { status: 200 })),
    ) as unknown as typeof fetch;
    const chunks = await collect(anthropicAdapter.call({ ...baseOpts }));
    expect(chunks).toEqual([
      { kind: "done", usage: { inputTokens: 0, outputTokens: 0 }, finishReason: "stop" },
    ]);
  });

  it("serialises a missing tool input as an empty object", async () => {
    const body = {
      content: [{ type: "tool_use", id: "t", name: "n" }],
      stop_reason: null,
      usage: { input_tokens: 1, output_tokens: 2 },
    };
    globalThis.fetch = vi.fn(() =>
      Promise.resolve(new Response(JSON.stringify(body), { status: 200 })),
    ) as unknown as typeof fetch;
    const chunks = await collect(anthropicAdapter.call({ ...baseOpts }));
    expect(chunks[0]).toEqual({ kind: "tool-call", id: "t", name: "n", argsJson: "{}" });
    expect((chunks.at(-1) as { finishReason: string }).finishReason).toBe("stop");
  });

  it("passes the abort signal through on the one-shot path", async () => {
    const fetchMock = vi.fn(() =>
      Promise.resolve(new Response(JSON.stringify({}), { status: 200 })),
    );
    globalThis.fetch = fetchMock as unknown as typeof fetch;
    const ctrl = new AbortController();
    await collect(anthropicAdapter.call({ ...baseOpts, signal: ctrl.signal }));
    const init = (fetchMock.mock.calls[0] as unknown as [string, RequestInit])[1];
    expect(init.signal).toBe(ctrl.signal);
  });

  it("yields an error chunk when the one-shot response is not ok", async () => {
    globalThis.fetch = vi.fn(() =>
      Promise.resolve(new Response("nope", { status: 401, statusText: "Unauthorized" })),
    ) as unknown as typeof fetch;
    const chunks = await collect(anthropicAdapter.call({ ...baseOpts }));
    expect(chunks).toEqual([{ kind: "error", message: "anthropic 401: nope" }]);
  });

  it("falls back to statusText when the one-shot error body cannot be read", async () => {
    const failingBody = new ReadableStream<Uint8Array>({
      start(c) {
        c.error(new Error("boom"));
      },
    });
    globalThis.fetch = vi.fn(() =>
      Promise.resolve(new Response(failingBody, { status: 500, statusText: "Server" })),
    ) as unknown as typeof fetch;
    const chunks = await collect(anthropicAdapter.call({ ...baseOpts }));
    expect(chunks).toEqual([{ kind: "error", message: "anthropic 500: Server" }]);
  });
});
