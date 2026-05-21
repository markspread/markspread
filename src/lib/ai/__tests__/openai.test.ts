// T-U13-001-FIX-B: OpenAI adapter coverage.

import { afterEach, describe, expect, it, vi } from "vitest";
import { openaiAdapter } from "../providers/openai";
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
  model: "gpt-4o-mini",
  messages: [{ role: "user", content: "hi" }],
};

afterEach(() => {
  globalThis.fetch = originalFetch;
  vi.restoreAllMocks();
});

describe("openaiAdapter streaming", () => {
  it("parses delta content, tool_calls and usage", async () => {
    const fetchMock = vi.fn(() =>
      Promise.resolve(
        streamingResponse([
          `data: ${JSON.stringify({ choices: [{ delta: { content: "Hello " } }] })}\n\n`,
          `data: ${JSON.stringify({ choices: [{ delta: { content: "world" } }] })}\n\n`,
          `data: ${JSON.stringify({
            choices: [
              {
                delta: {
                  tool_calls: [
                    { index: 0, id: "tc_1", function: { name: "search", arguments: '{"q":' } },
                  ],
                },
              },
            ],
          })}\n\n`,
          `data: ${JSON.stringify({
            choices: [{ delta: { tool_calls: [{ index: 0, function: { arguments: '"hi"}' } }] } }],
          })}\n\n`,
          `data: ${JSON.stringify({ choices: [{ delta: {}, finish_reason: "tool_calls" }] })}\n\n`,
          `data: ${JSON.stringify({
            choices: [],
            usage: { prompt_tokens: 4, completion_tokens: 11 },
          })}\n\n`,
          "data: [DONE]\n\n",
        ]),
      ),
    );
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    const chunks = await collect(
      openaiAdapter.call({
        ...baseOpts,
        stream: true,
        temperature: 0.2,
        maxTokens: 128,
        tools: [
          { name: "search", description: "find", parameters: { type: "object" } },
          { name: "noop", parameters: {} },
        ],
        messages: [
          { role: "user", content: "hi" },
          { role: "tool", content: '{"r":1}', name: "search" },
        ],
      }),
    );

    expect(chunks).toEqual([
      { kind: "text", delta: "Hello " },
      { kind: "text", delta: "world" },
      { kind: "tool-call", id: "tc_1", name: "search", argsJson: '{"q":"hi"}' },
      { kind: "done", usage: { inputTokens: 4, outputTokens: 11 }, finishReason: "tool_calls" },
    ]);
    const [url, init] = (fetchMock.mock.calls[0] ?? []) as unknown as [string, RequestInit];
    expect(url).toBe("https://api.openai.com/v1/chat/completions");
    expect(init.headers).toMatchObject({
      authorization: "Bearer sk-test",
    });
    const body = JSON.parse(init.body as string) as Record<string, unknown>;
    expect(body).toMatchObject({
      model: "gpt-4o-mini",
      stream: true,
      stream_options: { include_usage: true },
      temperature: 0.2,
      max_tokens: 128,
    });
    expect(
      (body.tools as Array<{ function: { description: string } }>)[1]?.function.description,
    ).toBe("");
    expect((body.messages as Array<Record<string, unknown>>)[1]?.name).toBe("search");
  });

  it("strips trailing slash from baseUrl and forwards the abort signal", async () => {
    const fetchMock = vi.fn(() => Promise.resolve(streamingResponse([])));
    globalThis.fetch = fetchMock as unknown as typeof fetch;
    const ctrl = new AbortController();
    await collect(
      openaiAdapter.call({
        ...baseOpts,
        stream: true,
        baseUrl: "https://proxy.example/v1/",
        signal: ctrl.signal,
      }),
    );
    const [url, init] = (fetchMock.mock.calls[0] ?? []) as unknown as [string, RequestInit];
    expect(url).toBe("https://proxy.example/v1/chat/completions");
    expect(init.signal).toBe(ctrl.signal);
  });

  it("yields an error chunk when the streaming response is not ok", async () => {
    globalThis.fetch = vi.fn(() =>
      Promise.resolve(new Response("nope", { status: 429, statusText: "Too Many" })),
    ) as unknown as typeof fetch;
    const chunks = await collect(openaiAdapter.call({ ...baseOpts, stream: true }));
    expect(chunks).toEqual([{ kind: "error", message: "openai 429: nope" }]);
  });

  it("falls back to statusText when the streaming error body cannot be read", async () => {
    const failing = new ReadableStream<Uint8Array>({
      start(c) {
        c.error(new Error("boom"));
      },
    });
    globalThis.fetch = vi.fn(() =>
      Promise.resolve(new Response(failing, { status: 500, statusText: "Server" })),
    ) as unknown as typeof fetch;
    const chunks = await collect(openaiAdapter.call({ ...baseOpts, stream: true }));
    expect(chunks).toEqual([{ kind: "error", message: "openai 500: Server" }]);
  });

  it("skips [DONE] and malformed payloads and tolerates missing choices/delta", async () => {
    globalThis.fetch = vi.fn(() =>
      Promise.resolve(
        streamingResponse([
          "data: [DONE]\n\n",
          "data: not-json\n\n",
          `data: ${JSON.stringify({})}\n\n`,
          `data: ${JSON.stringify({ choices: [{}] })}\n\n`,
          `data: ${JSON.stringify({
            choices: [{ delta: { content: null } }],
            usage: {},
          })}\n\n`,
        ]),
      ),
    ) as unknown as typeof fetch;
    const chunks = await collect(openaiAdapter.call({ ...baseOpts, stream: true }));
    expect(chunks).toEqual([
      { kind: "done", usage: { inputTokens: 0, outputTokens: 0 }, finishReason: "stop" },
    ]);
  });

  it("accumulates tool_calls without ids/names/arguments across deltas", async () => {
    globalThis.fetch = vi.fn(() =>
      Promise.resolve(
        streamingResponse([
          `data: ${JSON.stringify({
            choices: [{ delta: { tool_calls: [{ index: 0 }] } }],
          })}\n\n`,
          `data: ${JSON.stringify({
            choices: [{ delta: { tool_calls: [{ index: 0, function: {} }] } }],
          })}\n\n`,
        ]),
      ),
    ) as unknown as typeof fetch;
    const chunks = await collect(openaiAdapter.call({ ...baseOpts, stream: true }));
    expect(chunks).toEqual([
      { kind: "tool-call", id: "", name: "", argsJson: "" },
      { kind: "done", usage: { inputTokens: 0, outputTokens: 0 }, finishReason: "stop" },
    ]);
  });
});

describe("openaiAdapter one-shot", () => {
  it("emits text and tool-call blocks and a done chunk", async () => {
    const body = {
      choices: [
        {
          message: {
            content: "Hi there",
            tool_calls: [{ id: "tc_2", function: { name: "search", arguments: '{"q":"hi"}' } }],
          },
          finish_reason: "tool_calls",
        },
      ],
      usage: { prompt_tokens: 7, completion_tokens: 9 },
    };
    const fetchMock = vi.fn(() =>
      Promise.resolve(new Response(JSON.stringify(body), { status: 200 })),
    );
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    const chunks = await collect(openaiAdapter.call({ ...baseOpts }));
    expect(chunks).toEqual([
      { kind: "text", delta: "Hi there" },
      { kind: "tool-call", id: "tc_2", name: "search", argsJson: '{"q":"hi"}' },
      { kind: "done", usage: { inputTokens: 7, outputTokens: 9 }, finishReason: "tool_calls" },
    ]);
    const init = (fetchMock.mock.calls[0] as unknown as [string, RequestInit])[1];
    const reqBody = JSON.parse(init.body as string) as Record<string, unknown>;
    expect(reqBody.stream).toBe(false);
    expect(reqBody.stream_options).toBeUndefined();
  });

  it("returns defaults when choices/usage/finish_reason are missing", async () => {
    globalThis.fetch = vi.fn(() =>
      Promise.resolve(new Response(JSON.stringify({}), { status: 200 })),
    ) as unknown as typeof fetch;
    const chunks = await collect(openaiAdapter.call({ ...baseOpts }));
    expect(chunks).toEqual([
      { kind: "done", usage: { inputTokens: 0, outputTokens: 0 }, finishReason: "stop" },
    ]);
  });

  it("passes the abort signal through on the one-shot path", async () => {
    const fetchMock = vi.fn(() =>
      Promise.resolve(new Response(JSON.stringify({}), { status: 200 })),
    );
    globalThis.fetch = fetchMock as unknown as typeof fetch;
    const ctrl = new AbortController();
    await collect(openaiAdapter.call({ ...baseOpts, signal: ctrl.signal }));
    const init = (fetchMock.mock.calls[0] as unknown as [string, RequestInit])[1];
    expect(init.signal).toBe(ctrl.signal);
  });

  it("yields an error chunk when the one-shot response is not ok", async () => {
    globalThis.fetch = vi.fn(() =>
      Promise.resolve(new Response("bad", { status: 401, statusText: "Unauthorized" })),
    ) as unknown as typeof fetch;
    const chunks = await collect(openaiAdapter.call({ ...baseOpts }));
    expect(chunks).toEqual([{ kind: "error", message: "openai 401: bad" }]);
  });

  it("falls back to statusText when the one-shot error body cannot be read", async () => {
    const failing = new ReadableStream<Uint8Array>({
      start(c) {
        c.error(new Error("boom"));
      },
    });
    globalThis.fetch = vi.fn(() =>
      Promise.resolve(new Response(failing, { status: 500, statusText: "Server" })),
    ) as unknown as typeof fetch;
    const chunks = await collect(openaiAdapter.call({ ...baseOpts }));
    expect(chunks).toEqual([{ kind: "error", message: "openai 500: Server" }]);
  });
});
