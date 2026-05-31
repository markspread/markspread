// ADR-0013 T1.b: Plugin diagnostic 데이터 API 테스트.

import { describe, expect, it } from "vitest";
import { detail, snapshot } from "../diagnostics";
import { PluginHost, type WorkerFactory } from "../host";
import { PluginOrchestrator } from "../orchestrator";
import { type Message, createFakeWorkerPair } from "../sandbox-rpc";
import type { PluginManifest } from "../types";

function makeOrch(): PluginOrchestrator {
  const factory: WorkerFactory = () => {
    const { hostSide, pluginSide } = createFakeWorkerPair();
    pluginSide.addEventListener("message", (ev) => {
      const m = ev.data as Message;
      if (m.type === "host:init") {
        pluginSide.postMessage({ type: "plugin:ready", registered: [] });
      }
    });
    return hostSide;
  };
  const host = new PluginHost({ workerFactory: factory, handshakeTimeoutMs: 100 });
  return new PluginOrchestrator(host);
}

function man(name: string): PluginManifest {
  return {
    schemaVersion: 1,
    name,
    version: "0.1.0",
    entry: "./i.js",
    permissions: [],
    allowedHosts: [],
    contributes: {},
    render: "html",
    engines: { markspread: ">=1.3.0" },
  };
}

describe("snapshot — default off", () => {
  it("returns empty snapshot when disabled", () => {
    const orch = makeOrch();
    const snap = snapshot(orch, false);
    expect(snap.enabled).toBe(false);
    expect(snap.plugins).toEqual([]);
    expect(snap.summary).toMatch(/off/);
  });
});

describe("snapshot — enabled", () => {
  it("lists local plugin with always-consented + lock icon", async () => {
    const orch = makeOrch();
    await orch.install(
      {
        manifest: man("p1"),
        pluginDir: "/tmp/p1",
        scope: "user",
        trustLevel: "local",
        source: "x",
      },
      100,
    );
    const snap = snapshot(orch, true);
    expect(snap.enabled).toBe(true);
    expect(snap.plugins).toHaveLength(1);
    const [entry] = snap.plugins;
    if (!entry) throw new Error("expected entry");
    expect(entry.pluginName).toBe("p1");
    expect(entry.trustLevel).toBe("local");
    expect(entry.trustIcon).toBe("lock");
    expect(entry.hasConsent).toBe(true);
    expect(entry.assignedAt).toBe(100);
  });

  it("shows llm-generated plugin with bot + consent state", async () => {
    const orch = makeOrch();
    const input = {
      manifest: man("p2"),
      pluginDir: "/tmp/p2",
      scope: "user" as const,
      trustLevel: "llm-generated" as const,
      source: "x",
      authoredBy: "claude-sonnet-4-6",
    };
    await orch.install(input, 100);
    const snapBefore = snapshot(orch, true);
    expect(snapBefore.plugins[0]?.hasConsent).toBe(false);
    expect(snapBefore.plugins[0]?.trustIcon).toBe("bot");
    expect(snapBefore.plugins[0]?.authoredBy).toBe("claude-sonnet-4-6");

    await orch.resolveConsent(input, "accept", 200);
    const snapAfter = snapshot(orch, true);
    expect(snapAfter.plugins[0]?.hasConsent).toBe(true);
    expect(snapAfter.plugins[0]?.consentedAt).toBe(200);
  });

  it("shows imported plugin with shield + origin", async () => {
    const orch = makeOrch();
    await orch.install(
      {
        manifest: man("p3"),
        pluginDir: "/tmp/p3",
        scope: "user",
        trustLevel: "imported",
        source: "x",
        origin: "https://github.com/markspread/parser-x",
      },
      100,
    );
    const snap = snapshot(orch, true);
    expect(snap.plugins[0]?.trustIcon).toBe("shield");
    expect(snap.plugins[0]?.origin).toBe("https://github.com/markspread/parser-x");
  });

  it("summary reflects count", async () => {
    const orch = makeOrch();
    await orch.install(
      { manifest: man("a"), pluginDir: "/a", scope: "user", trustLevel: "local", source: "x" },
      0,
    );
    await orch.install(
      { manifest: man("b"), pluginDir: "/b", scope: "user", trustLevel: "local", source: "x" },
      0,
    );
    const snap = snapshot(orch, true);
    expect(snap.summary).toBe("2 plugin(s) registered");
  });
});

describe("detail", () => {
  it("returns single entry by name", async () => {
    const orch = makeOrch();
    await orch.install(
      { manifest: man("p1"), pluginDir: "/p1", scope: "user", trustLevel: "local", source: "x" },
      50,
    );
    const e = detail(orch, "p1");
    expect(e?.pluginName).toBe("p1");
  });

  it("returns null for unknown", () => {
    const orch = makeOrch();
    expect(detail(orch, "ghost")).toBeNull();
  });
});
