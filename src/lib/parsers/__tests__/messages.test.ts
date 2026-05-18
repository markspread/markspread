// S-PSDK-003: parser/host postMessage 스키마 검증 회귀.

import { describe, expect, it } from "vitest";
import { validateIncomingMessage } from "../messages";

describe("validateIncomingMessage", () => {
  it("accepts a well-formed parse:ok html response", () => {
    const v = validateIncomingMessage({
      type: "parse:ok",
      requestId: "r1",
      parserId: "p1",
      result: { kind: "html", html: "<p>hi</p>" },
    });
    expect(v.ok).toBe(true);
  });

  it("accepts a well-formed parse:ok ast response with warnings", () => {
    const v = validateIncomingMessage({
      type: "parse:ok",
      requestId: "r1",
      parserId: "p1",
      result: { kind: "ast", ast: { foo: 1 } },
      warnings: ["w1"],
    });
    expect(v.ok).toBe(true);
  });

  it("accepts a parse:err message", () => {
    const v = validateIncomingMessage({
      type: "parse:err",
      requestId: "r1",
      parserId: "p1",
      message: "boom",
    });
    expect(v.ok).toBe(true);
  });

  it("rejects an unknown message type", () => {
    const v = validateIncomingMessage({ type: "parse:wat" });
    expect(v.ok).toBe(false);
  });

  it("rejects parse:ok missing required result", () => {
    const v = validateIncomingMessage({
      type: "parse:ok",
      requestId: "r1",
      parserId: "p1",
    });
    expect(v.ok).toBe(false);
  });

  it("rejects parse:ok with wrong-typed html field", () => {
    const v = validateIncomingMessage({
      type: "parse:ok",
      requestId: "r1",
      parserId: "p1",
      result: { kind: "html", html: 42 },
    });
    expect(v.ok).toBe(false);
  });

  it("rejects empty requestId", () => {
    const v = validateIncomingMessage({
      type: "parse:err",
      requestId: "",
      parserId: "p",
      message: "x",
    });
    expect(v.ok).toBe(false);
  });

  it("strips unknown fields but accepts the message", () => {
    const v = validateIncomingMessage({
      type: "parse:ok",
      requestId: "r1",
      parserId: "p1",
      result: { kind: "html", html: "<p/>" },
      sneaky: "<script>alert(1)</script>",
    });
    expect(v.ok).toBe(true);
    if (v.ok) {
      expect((v.value as Record<string, unknown>).sneaky).toBeUndefined();
    }
  });
});
