// S-PSDK-001: 호스트 등록 위임 회귀. host 가 주입되기 전 호출은 에러를 던지고,
// 주입 후에는 host 의 핸들러가 manifest + factory 를 그대로 받아야 한다.

import { afterEach, describe, expect, it, vi } from "vitest";
import type { ParserManifest } from "../manifest";
import {
  registerParser,
  registerRenderer,
  setRegistryHost,
  type RendererSpec,
} from "../register";

const manifest: ParserManifest = {
  id: "demo",
  version: "0.0.1",
  displayName: "Demo",
  fileMatch: { extensions: [".demo"] },
  capabilities: "preview-only",
  entry: "./e.js",
};

afterEach(() => {
  setRegistryHost(null);
});

describe("registerParser / registerRenderer", () => {
  it("throws when no host is installed", () => {
    expect(() => registerParser(manifest, () => ({ ast: null }))).toThrow(
      /host registry/,
    );
  });

  it("delegates to the installed host", () => {
    const registerParserSpy = vi.fn();
    const registerRendererSpy = vi.fn();
    setRegistryHost({
      registerParser: registerParserSpy,
      registerRenderer: registerRendererSpy,
    });
    const factory = () => ({ ast: { kind: "noop" } });
    const spec: RendererSpec = {
      kind: "html",
      parserId: "demo",
      render: () => "<div/>",
    };
    registerParser(manifest, factory);
    registerRenderer(spec);
    expect(registerParserSpy).toHaveBeenCalledWith(manifest, factory);
    expect(registerRendererSpy).toHaveBeenCalledWith(spec);
  });

  it("setRegistryHost(null) disables further registration", () => {
    setRegistryHost({
      registerParser: vi.fn(),
      registerRenderer: vi.fn(),
    });
    setRegistryHost(null);
    expect(() => registerRenderer({ kind: "html", parserId: "demo", render: () => "" })).toThrow();
  });
});
