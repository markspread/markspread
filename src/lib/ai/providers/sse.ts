// S-AI-RUN-002: minimal SSE parser shared by the streaming adapters.
//
// We avoid the EventSource API because (a) it can't send custom headers
// (Auth, anthropic-version) and (b) it auto-reconnects, which is wrong
// for a one-shot message stream. Reading the body as a ReadableStream
// and parsing `data:` lines by hand is ~30 LOC and gives full control
// over abort + framing.

export async function* sseFromResponse(
  response: Response,
  signal?: AbortSignal,
): AsyncGenerator<{ event: string; data: string }, void, void> {
  if (!response.body) return;
  const reader = response.body.getReader();
  const decoder = new TextDecoder("utf-8");
  let buf = "";
  let currentEvent = "message";

  // Split off complete `\n`-terminated lines; leave the partial tail in
  // `buf`. With `flush = true` the remaining tail is treated as a final
  // line so a stream that ends without a trailing newline isn't dropped.
  function* drain(flush: boolean): Generator<{ event: string; data: string }> {
    let nl = buf.indexOf("\n");
    while (nl !== -1) {
      const line = buf.slice(0, nl).replace(/\r$/, "");
      buf = buf.slice(nl + 1);
      yield* handle(line);
      nl = buf.indexOf("\n");
    }
    if (flush) {
      const tail = buf.replace(/\r$/, "");
      buf = "";
      if (tail.length > 0) yield* handle(tail);
    }
  }

  function* handle(line: string): Generator<{ event: string; data: string }> {
    if (line.length === 0) {
      // empty line ends a record — nothing to emit here because
      // each `data:` line is emitted as it's seen.
      currentEvent = "message";
    } else if (line.startsWith("event:")) {
      currentEvent = line.slice(6).trim();
    } else if (line.startsWith("data:")) {
      yield { event: currentEvent, data: line.slice(5).trimStart() };
    }
  }

  try {
    while (true) {
      if (signal?.aborted) {
        await reader.cancel().catch(() => {});
        return;
      }
      const { value, done } = await reader.read();
      if (done) break;
      buf += decoder.decode(value, { stream: true });
      yield* drain(false);
    }
    // The stream may end without a trailing newline — flush whatever
    // remains so a final `data:` line isn't silently dropped.
    buf += decoder.decode();
    yield* drain(true);
  } finally {
    reader.releaseLock();
  }
}
