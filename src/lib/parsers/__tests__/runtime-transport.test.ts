// SC-SEC-01 / ADR-0012 D1: 런타임 파서 Worker transport 유닛 검증.
//
// 노드 환경에는 Worker 가 없다 — buildParserWorkerScript 산출물은 fake self
// 로 직접 실행해 *실제 worker bootstrap 로직* 을 고정하고, 기본 factory 는
// fail-closed(모든 요청 parse:err) 임을 고정한다.

import { afterEach, describe, expect, it } from "vitest";
import type { ParseRequest } from "../messages";
import {
  __resetRuntimeParserTransportsForTests,
  activateRuntimeParser,
  createInProcessParserTransportForTests,
  disposeRuntimeParser,
  getRuntimeParserSuspension,
  stripFactorySource,
  suspendRuntimeParser,
} from "../runtime-transport";
import { __resetParserTransportsForTests, getParserTransport } from "../transport-registry";

afterEach(() => {
  __resetParserTransportsForTests();
  __resetRuntimeParserTransportsForTests();
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
