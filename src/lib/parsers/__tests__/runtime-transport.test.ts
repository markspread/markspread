// SC-SEC-01 / ADR-0012 D1: 런타임 파서 Worker transport 유닛 검증.
//
// 노드 환경에는 Worker 가 없다 — buildParserWorkerScript 산출물은 fake self
// 로 직접 실행해 *실제 worker bootstrap 로직* 을 고정하고, 기본 factory 는
// fail-closed(모든 요청 parse:err) 임을 고정한다.

import { afterEach, describe, expect, it, vi } from "vitest";
import type { ParseRequest } from "../messages";
import {
  __resetRuntimeParserTransportsForTests,
  activateRuntimeParser,
  createInProcessParserTransportForTests,
  disposeRuntimeParser,
  getRuntimeParserSuspension,
  setRuntimeParserTransportFactoryForTests,
  stripFactorySource,
  suspendRuntimeParser,
} from "../runtime-transport";
import { __resetParserTransportsForTests, getParserTransport } from "../transport-registry";

afterEach(() => {
  __resetParserTransportsForTests();
  __resetRuntimeParserTransportsForTests();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

function req(overrides: Partial<ParseRequest> = {}): ParseRequest {
  return {
    type: "parse",
    requestId: "rq-1",
    parserId: "p-1",
    path: "/x.custom",
    content: "hello",
    encoding: "utf-8",
    ...overrides,
  };
}

function roundtrip(source: string, request: ParseRequest = req()): Promise<unknown> {
  const transport = createInProcessParserTransportForTests("p-1", source);
  return new Promise((resolve) => {
    transport.onMessage((raw) => resolve(raw));
    transport.postMessage(request);
  });
}

describe("stripFactorySource", () => {
  it("strips export default / module.exports", () => {
    expect(stripFactorySource("export default (i) => i")).toBe("(i) => i");
    expect(stripFactorySource("module.exports = (i) => i")).toBe("(i) => i");
    expect(stripFactorySource("  (i) => i  ")).toBe("(i) => i");
  });
});

describe("buildParserWorkerScript — worker bootstrap contract", () => {
  it("runs the factory and replies parse:ok with the ast", async () => {
    const msg = await roundtrip(
      `(input) => ({ ast: { kind: "html", html: "W:" + input.content } })`,
    );
    expect(msg).toEqual({
      type: "parse:ok",
      requestId: "rq-1",
      parserId: "p-1",
      result: { kind: "ast", ast: { kind: "html", html: "W:hello" } },
    });
  });

  it("wraps a non-{ast} return into a raw ast (evaluateFactory 규칙과 동일)", async () => {
    const msg = (await roundtrip(`(input) => "bare:" + input.content`)) as {
      result: { ast: unknown };
    };
    expect(msg.result.ast).toEqual({ kind: "raw", value: "bare:hello" });
  });

  it("replies parse:err when the source is not a function", async () => {
    const msg = (await roundtrip("42")) as { type: string; message: string };
    expect(msg.type).toBe("parse:err");
    expect(msg.message).toMatch(/must be a function, got number/);
  });

  it("replies parse:err when top-level evaluation throws (string throw normalised)", async () => {
    const msg = (await roundtrip(`(() => { throw "plain-string-failure" })()`)) as {
      type: string;
      message: string;
    };
    expect(msg.type).toBe("parse:err");
    expect(msg.message).toBe("plain-string-failure");
  });

  it("replies parse:err when the factory throws at parse time", async () => {
    const msg = (await roundtrip(`() => { throw new Error("boom-at-parse"); }`)) as {
      type: string;
      message: string;
    };
    expect(msg.type).toBe("parse:err");
    expect(msg.message).toBe("boom-at-parse");
  });

  it("ignores non-parse messages", async () => {
    const transport = createInProcessParserTransportForTests(
      "p-1",
      `(input) => ({ ast: { kind: "raw", value: input.content } })`,
    );
    let received: unknown = null;
    transport.onMessage((raw) => {
      received = raw;
    });
    transport.postMessage({ type: "nope" } as never);
    await new Promise((r) => setTimeout(r, 10));
    expect(received).toBeNull();
  });

  it("in-process transport stops delivering after unsubscribe / dispose", async () => {
    const make = () =>
      createInProcessParserTransportForTests(
        "p-1",
        `(input) => ({ ast: { kind: "raw", value: input.content } })`,
      );
    let received: unknown = null;
    const record = (raw: unknown) => {
      received = raw;
    };

    const unsubbed = make();
    unsubbed.onMessage(record)();
    unsubbed.postMessage(req());
    await new Promise((r) => setTimeout(r, 10));
    expect(received).toBeNull();

    const disposed = make();
    disposed.onMessage(record);
    disposed.dispose();
    disposed.postMessage(req());
    await new Promise((r) => setTimeout(r, 10));
    expect(received).toBeNull();
  });

  it("accepts export default sources", async () => {
    const msg = (await roundtrip(
      `export default (input) => ({ ast: { kind: "html", html: input.content } })`,
    )) as { type: string };
    expect(msg.type).toBe("parse:ok");
  });
});

describe("activate / suspend lifecycle", () => {
  it("default factory is fail-closed when Worker is unavailable (SC-SEC-01)", async () => {
    // 노드 환경: Worker 없음 → in-process 강등이 아니라 parse:err 차단.
    expect(typeof Worker).toBe("undefined");
    activateRuntimeParser("no-worker", `(i) => ({ ast: { kind: "raw", value: i.content } })`);
    const transport = getParserTransport("no-worker");
    expect(transport).not.toBeNull();
    const reply = await new Promise<{ type: string; message?: string }>((resolve) => {
      transport?.onMessage((raw) => resolve(raw as { type: string; message?: string }));
      transport?.postMessage(req({ parserId: "no-worker" }));
    });
    expect(reply.type).toBe("parse:err");
    expect(reply.message).toMatch(/isolation unavailable/);
  });

  it("fail-closed transport stops delivering after unsubscribe", async () => {
    activateRuntimeParser("fc-unsub", "(i) => i");
    const transport = getParserTransport("fc-unsub");
    expect(transport).not.toBeNull();
    let received: unknown = null;
    const unsubscribe = transport?.onMessage((raw) => {
      received = raw;
    });
    unsubscribe?.();
    transport?.postMessage(req({ parserId: "fc-unsub" }));
    await new Promise((r) => setTimeout(r, 10));
    expect(received).toBeNull();
  });

  it("suspendRuntimeParser disposes the transport and records the reason", () => {
    activateRuntimeParser("susp", "(i) => i");
    expect(getParserTransport("susp")).not.toBeNull();
    suspendRuntimeParser("susp", "susp 시간 초과 — suspend");
    expect(getParserTransport("susp")).toBeNull();
    expect(getRuntimeParserSuspension("susp")).toContain("시간 초과");
    // 재활성은 suspend 해제.
    activateRuntimeParser("susp", "(i) => i");
    expect(getRuntimeParserSuspension("susp")).toBeNull();
    expect(getParserTransport("susp")).not.toBeNull();
  });

  it("disposeRuntimeParser clears transport + suspension", () => {
    activateRuntimeParser("disp", "(i) => i");
    suspendRuntimeParser("disp", "x");
    disposeRuntimeParser("disp");
    expect(getParserTransport("disp")).toBeNull();
    expect(getRuntimeParserSuspension("disp")).toBeNull();
  });
});

describe("default factory — real Worker path", () => {
  // 노드에는 Worker 가 없으므로 blob Worker 배선(생성자 URL, postMessage/
  // onmessage 어댑팅, dispose→terminate+revokeObjectURL)은 fake Worker
  // 클래스를 global 로 심어 고정한다.
  class FakeWorker {
    static instances: FakeWorker[] = [];
    url: string;
    options: unknown;
    posted: unknown[] = [];
    terminated = false;
    private listeners: Array<(ev: { data: unknown }) => void> = [];
    constructor(url: string, options?: unknown) {
      this.url = url;
      this.options = options;
      FakeWorker.instances.push(this);
    }
    addEventListener(type: string, fn: (ev: { data: unknown }) => void): void {
      if (type === "message") this.listeners.push(fn);
    }
    postMessage(msg: unknown): void {
      this.posted.push(msg);
    }
    terminate(): void {
      this.terminated = true;
    }
    emit(data: unknown): void {
      for (const fn of this.listeners) fn({ data });
    }
  }

  it("spins up a blob Worker, adapts messages, and disposes via terminate + revoke", async () => {
    FakeWorker.instances.length = 0;
    vi.stubGlobal("Worker", FakeWorker);
    const createSpy = vi.spyOn(URL, "createObjectURL").mockReturnValue("blob:fake-parser");
    const revokeSpy = vi.spyOn(URL, "revokeObjectURL").mockImplementation(() => {});

    // null 로 리셋하면 default factory 로 되돌아간다 (?? 분기).
    setRuntimeParserTransportFactoryForTests(null);
    activateRuntimeParser("real", `(i) => ({ ast: { kind: "raw", value: i.content } })`);

    // 생성자는 bootstrap 스크립트가 담긴 blob URL 을 받는다.
    const blob = createSpy.mock.calls[0]?.[0] as Blob;
    expect(blob.type).toBe("text/javascript");
    expect(await blob.text()).toContain("self.onmessage");
    expect(FakeWorker.instances).toHaveLength(1);
    const worker = FakeWorker.instances[0] as FakeWorker;
    expect(worker.url).toBe("blob:fake-parser");

    const transport = getParserTransport("real");
    expect(transport?.mode).toBe("worker");

    // postMessage → worker.postMessage 로 전달.
    const request = req({ parserId: "real" });
    transport?.postMessage(request);
    expect(worker.posted).toEqual([request]);

    // worker message 이벤트 → onMessage 핸들러로 어댑팅.
    let received: unknown = null;
    transport?.onMessage((raw) => {
      received = raw;
    });
    const reply = { type: "parse:ok", requestId: "rq-1", parserId: "real" };
    worker.emit(reply);
    expect(received).toEqual(reply);

    // dispose → terminate + blob URL 회수.
    transport?.dispose();
    expect(worker.terminated).toBe(true);
    expect(revokeSpy).toHaveBeenCalledWith("blob:fake-parser");
  });
});
