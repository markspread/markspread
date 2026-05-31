// 글로벌 PluginOrchestrator 싱글턴 단위 테스트 — lazy 캐시 + reset + default factory.

import { afterEach, describe, expect, it } from "vitest";
import { getOrchestrator, resetOrchestrator } from "../orchestrator-singleton";
import type { PluginManifest } from "../types";

function manifest(name: string): PluginManifest {
  return {
    schemaVersion: 1,
    name,
    version: "0.1.0",
    entry: "./index.js",
    permissions: [],
    allowedHosts: [],
    contributes: { fences: [{ name: "alert", render: "html" as const }] },
    render: "html",
    engines: { markspread: ">=1.3.0" },
  };
}

afterEach(() => resetOrchestrator());

describe("orchestrator-singleton", () => {
  it("getOrchestrator returns a cached instance on repeated calls", () => {
    const a = getOrchestrator();
    const b = getOrchestrator();
    expect(a).toBe(b);
  });

  it("resetOrchestrator clears the cache → new instance afterwards", () => {
    const a = getOrchestrator();
    resetOrchestrator();
    const b = getOrchestrator();
    expect(a).not.toBe(b);
  });

  it("defaultWorkerFactory replies plugin:err on host:init → install ends in error state", async () => {
    const orch = getOrchestrator();
    // local trust → host.install → spawn → defaultWorkerFactory wiring fires.
    const result = await orch.install(
      {
        manifest: manifest("singleton-p"),
        pluginDir: "/tmp/singleton-p",
        scope: "user",
        trustLevel: "local",
        source: "export default (s) => s",
      },
      0,
    );
    expect(result.consent.action).toBe("skip-local");
    // default factory rejects handshake with plugin:err → host marks state "error".
    expect(result.handle.state).toBe("error");
    expect(result.handle.errorMessage).toContain("default factory");
  });
});
