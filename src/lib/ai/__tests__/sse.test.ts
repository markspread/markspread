// S-AI-RUN-002: SSE parser coverage.

import { describe, expect, it } from "vitest";
import { sseFromResponse } from "../providers/sse";

function responseOf(chunks: string[]): Response {
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      const enc = new TextEncoder();
      for (const c of chunks) controller.enqueue(enc.encode(c));
      controller.close();
    },
  });
  return new Response(stream);
}

async function collect(
  gen: AsyncGenerator<{ event: string; data: string }, void, void>,
): Promise<{ event: string; data: string }[]> {
  const out: { event: string; data: string }[] = [];
  for await (const ev of gen) out.push(ev);
  return out;
}

describe("sseFromResponse", () => {
  it("yields nothing for a response with no body", async () => {
    const res = new Response(null);
    expect(await collect(sseFromResponse(res))).toEqual([]);
  });

  it("parses simple data lines", async () => {
    const events = await collect(sseFromResponse(responseOf(["data: hello\n", "data: world\n"])));
    expect(events).toEqual([
      { event: "message", data: "hello" },
      { event: "message", data: "world" },
    ]);
  });

  it("honours named events", async () => {
    const events = await collect(sseFromResponse(responseOf(["event: ping\n", "data: payload\n"])));
    expect(events[0]).toEqual({ event: "ping", data: "payload" });
  });

  it("resets the event name after a blank line", async () => {
    const events = await collect(sseFromResponse(responseOf(["event: ping\n", "\n", "data: x\n"])));
    expect(events[0]?.event).toBe("message");
  });

  it("flushes a final data line that lacks a trailing newline", async () => {
    const events = await collect(sseFromResponse(responseOf(["data: tail"])));
    expect(events).toEqual([{ event: "message", data: "tail" }]);
  });

  it("strips carriage returns from CRLF streams", async () => {
    const events = await collect(sseFromResponse(responseOf(["data: crlf\r\n"])));
    expect(events[0]?.data).toBe("crlf");
  });

  it("handles a data line split across chunks", async () => {
    const events = await collect(sseFromResponse(responseOf(["data: par", "tial\n"])));
    expect(events[0]?.data).toBe("partial");
  });

  it("stops promptly when the signal is already aborted", async () => {
    const ctrl = new AbortController();
    ctrl.abort();
    const events = await collect(sseFromResponse(responseOf(["data: x\n"]), ctrl.signal));
    expect(events).toEqual([]);
  });
});
