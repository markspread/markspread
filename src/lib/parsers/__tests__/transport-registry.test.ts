// T-U10-002: per-parser SandboxTransport registry coverage.

import { beforeEach, describe, expect, it, vi } from "vitest";
import type { SandboxTransport } from "../renderer-host";
import {
  __resetParserTransportsForTests,
  getParserTransport,
  registerParserTransport,
  unregisterParserTransport,
} from "../transport-registry";

function fakeTransport(): SandboxTransport & { dispose: ReturnType<typeof vi.fn> } {
  return {
    render: vi.fn(),
    dispose: vi.fn(),
  } as unknown as SandboxTransport & { dispose: ReturnType<typeof vi.fn> };
}

beforeEach(() => __resetParserTransportsForTests());

describe("transport-registry", () => {
  it("registers and retrieves a transport by parser id", () => {
    const t = fakeTransport();
    registerParserTransport("p1", t);
    expect(getParserTransport("p1")).toBe(t);
  });

  it("returns null when the parser id is unknown", () => {
    expect(getParserTransport("missing")).toBeNull();
  });

  it("disposes the previous transport when re-registering the same id", () => {
    const a = fakeTransport();
    const b = fakeTransport();
    registerParserTransport("p1", a);
    registerParserTransport("p1", b);
    expect(a.dispose).toHaveBeenCalledTimes(1);
    expect(getParserTransport("p1")).toBe(b);
  });

  it("disposes and removes a transport on unregister", () => {
    const t = fakeTransport();
    registerParserTransport("p1", t);
    unregisterParserTransport("p1");
    expect(t.dispose).toHaveBeenCalledTimes(1);
    expect(getParserTransport("p1")).toBeNull();
  });

  it("unregistering an unknown id is a no-op", () => {
    expect(() => unregisterParserTransport("nope")).not.toThrow();
  });

  it("__resetParserTransportsForTests disposes every entry and clears the map", () => {
    const a = fakeTransport();
    const b = fakeTransport();
    registerParserTransport("a", a);
    registerParserTransport("b", b);
    __resetParserTransportsForTests();
    expect(a.dispose).toHaveBeenCalledTimes(1);
    expect(b.dispose).toHaveBeenCalledTimes(1);
    expect(getParserTransport("a")).toBeNull();
    expect(getParserTransport("b")).toBeNull();
  });
});
