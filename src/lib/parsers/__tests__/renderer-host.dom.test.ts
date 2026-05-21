// S-PSDK-003: renderInSandbox 호스트 회귀.
// jsdom 필요 — sanitiseMarkdownHtml 가 DOMParser 를 사용한다.

import { describe, expect, it, vi } from "vitest";
import type { ParseRequest } from "../messages";
import {
  type SandboxTransport,
  buildIframeSrcdoc,
  createWorkerTransport,
  renderInSandbox,
} from "../renderer-host";

function fakeTransport(
  reply: unknown,
  opts: { mode?: "worker" | "iframe" } = {},
): SandboxTransport {
  let handler: ((raw: unknown) => void) | null = null;
  return {
    mode: opts.mode ?? "worker",
    postMessage: () => {
      // 다음 마이크로태스크에서 reply 발사.
      queueMicrotask(() => handler?.(reply));
    },
    onMessage: (h) => {
      handler = h;
      return () => {
        handler = null;
      };
    },
    dispose: () => {},
  };
}

const REQ: ParseRequest = {
  type: "parse",
  requestId: "r1",
  parserId: "p1",
  path: "/a.md",
  content: "hi",
  encoding: "utf-8",
};

describe("renderInSandbox", () => {
  it("returns sanitised HTML and strips XSS payload", async () => {
    const t = fakeTransport({
      type: "parse:ok",
      requestId: "r1",
      parserId: "p1",
      result: {
        kind: "html",
        html: '<p>ok</p><script>alert(1)</script><a href="javascript:bad()">x</a>',
      },
    });
    const r = await renderInSandbox(t, REQ);
    expect(r.kind).toBe("html");
    if (r.kind === "html") {
      expect(r.html).not.toMatch(/<script/i);
      expect(r.html).not.toMatch(/javascript:/i);
      expect(r.html).toMatch(/<p>ok<\/p>/);
    }
  });

  it("rejects messages that fail schema validation", async () => {
    const t = fakeTransport({
      type: "parse:ok",
      requestId: "r1",
      parserId: "p1",
      // result is missing — schema rejects.
    });
    const r = await renderInSandbox(t, REQ);
    expect(r.kind).toBe("error");
    if (r.kind === "error") {
      expect(r.message).toMatch(/schema/);
      expect(r.rejectedReason).toBeTruthy();
    }
  });

  it("propagates parse:err messages", async () => {
    const t = fakeTransport({
      type: "parse:err",
      requestId: "r1",
      parserId: "p1",
      message: "syntax error at line 4",
    });
    const r = await renderInSandbox(t, REQ);
    expect(r.kind).toBe("error");
    if (r.kind === "error") {
      expect(r.message).toBe("syntax error at line 4");
    }
  });

  it("returns ast results unchanged", async () => {
    const t = fakeTransport({
      type: "parse:ok",
      requestId: "r1",
      parserId: "p1",
      result: { kind: "ast", ast: { node: "root", children: [] } },
      warnings: ["w"],
    });
    const r = await renderInSandbox(t, REQ);
    expect(r.kind).toBe("ast");
    if (r.kind === "ast") {
      expect(r.ast).toEqual({ node: "root", children: [] });
      expect(r.warnings).toEqual(["w"]);
    }
  });

  it("times out when the sandbox never replies", async () => {
    const t: SandboxTransport = {
      mode: "worker",
      postMessage: () => {},
      onMessage: () => () => {},
      dispose: () => {},
    };
    const r = await renderInSandbox(t, REQ, { timeoutMs: 20 });
    expect(r.kind).toBe("error");
    if (r.kind === "error") {
      expect(r.message).toMatch(/timed out/);
    }
  });

  it("ignores replies that don't match requestId", async () => {
    let handler: ((raw: unknown) => void) | null = null;
    const t: SandboxTransport = {
      mode: "worker",
      postMessage: () => {
        queueMicrotask(() => {
          // wrong requestId first
          handler?.({
            type: "parse:ok",
            requestId: "other",
            parserId: "p1",
            result: { kind: "ast", ast: 99 },
          });
          // then correct
          handler?.({
            type: "parse:ok",
            requestId: "r1",
            parserId: "p1",
            result: { kind: "ast", ast: 42 },
          });
        });
      },
      onMessage: (h) => {
        handler = h;
        return () => {
          handler = null;
        };
      },
      dispose: () => {},
    };
    const r = await renderInSandbox(t, REQ);
    expect(r.kind).toBe("ast");
    if (r.kind === "ast") expect(r.ast).toBe(42);
  });
});

describe("buildIframeSrcdoc", () => {
  it("inlines the CSP meta and the parser script", () => {
    const html = buildIframeSrcdoc("console.log(1)", "default-src 'none'");
    expect(html).toMatch(/<meta http-equiv="Content-Security-Policy" content="default-src 'none'"/);
    expect(html).toMatch(/<script type="module">console\.log\(1\)<\/script>/);
  });
});

describe("createWorkerTransport", () => {
  it("wires postMessage and message events through to the host handler", () => {
    let messageListener: ((ev: { data: unknown }) => void) | null = null;
    const postMessage = vi.fn();
    const terminate = vi.fn();
    class FakeWorker {
      constructor(
        public url: string,
        public opts?: WorkerOptions,
      ) {}
      addEventListener(type: string, fn: (ev: { data: unknown }) => void): void {
        if (type === "message") messageListener = fn;
      }
      postMessage = postMessage;
      terminate = terminate;
    }
    const original = (globalThis as { Worker?: unknown }).Worker;
    (globalThis as { Worker: unknown }).Worker = FakeWorker;
    try {
      const t = createWorkerTransport("blob:fake");
      expect(t.mode).toBe("worker");

      const seen: unknown[] = [];
      const off = t.onMessage((raw) => seen.push(raw));
      const ml = messageListener as ((ev: { data: unknown }) => void) | null;
      ml?.({ data: { hello: 1 } });
      expect(seen).toEqual([{ hello: 1 }]);

      const req = {
        type: "parse",
        requestId: "r1",
        parserId: "p",
        path: "/a.md",
        content: "x",
        encoding: "utf-8",
      } as ParseRequest;
      t.postMessage(req);
      expect(postMessage).toHaveBeenCalledWith(req);

      off();
      ml?.({ data: { hello: 2 } });
      expect(seen).toEqual([{ hello: 1 }]);

      t.dispose();
      expect(terminate).toHaveBeenCalled();
    } finally {
      if (original === undefined) {
        (globalThis as { Worker?: unknown }).Worker = undefined;
      } else {
        (globalThis as { Worker: unknown }).Worker = original;
      }
    }
  });
});
