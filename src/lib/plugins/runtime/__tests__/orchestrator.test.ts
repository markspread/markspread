// ADR-0013 + ADR-0016: PluginOrchestrator 통합 테스트.

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { resetSanitizer, setSanitizer } from "../../../preview/sanitizer";
import { PluginHost, type WorkerFactory } from "../host";
import { PluginOrchestrator } from "../orchestrator";
import { type Message, createFakeWorkerPair } from "../sandbox-rpc";
import type { PluginManifest } from "../types";

function manifest(name: string, fence = "alert"): PluginManifest {
  return {
    schemaVersion: 1,
    name,
    version: "0.1.0",
    entry: "./index.js",
    permissions: [],
    allowedHosts: [],
    contributes: { fences: [{ name: fence, render: "html" as const }] },
    render: "html",
    engines: { markspread: ">=1.3.0" },
  };
}

function codeblockManifest(name: string, lang = "wireweave"): PluginManifest {
  return {
    schemaVersion: 1,
    name,
    version: "0.1.0",
    entry: "./index.js",
    permissions: [],
    allowedHosts: [],
    contributes: { codeblocks: { [lang]: { render: "html" as const } } },
    render: "html",
    engines: { markspread: ">=1.3.0" },
  };
}

/** Worker that registers a codeblock and echoes html. */
function codeblockWorkerFactory(lang: string): WorkerFactory {
  return () => {
    const { hostSide, pluginSide } = createFakeWorkerPair();
    pluginSide.addEventListener("message", (ev) => {
      const m = ev.data as Message;
      if (m.type === "host:init") {
        pluginSide.postMessage({
          type: "plugin:ready",
          registered: [{ kind: "codeblock", key: lang }],
        });
      } else if (m.type === "hook:invoke") {
        pluginSide.postMessage({
          type: "hook:result",
          requestId: m.requestId,
          result: { kind: "html", html: `CB:${m.payload.source}` },
        });
      }
    });
    return hostSide;
  };
}

/** Worker whose hook returns a plugin-side error result. */
function errorResultWorkerFactory(fence: string): WorkerFactory {
  return () => {
    const { hostSide, pluginSide } = createFakeWorkerPair();
    pluginSide.addEventListener("message", (ev) => {
      const m = ev.data as Message;
      if (m.type === "host:init") {
        pluginSide.postMessage({
          type: "plugin:ready",
          registered: [{ kind: "fence", key: fence }],
        });
      } else if (m.type === "hook:invoke") {
        pluginSide.postMessage({
          type: "hook:result",
          requestId: m.requestId,
          result: { kind: "error", message: "render blew up" },
        });
      }
    });
    return hostSide;
  };
}

/** Worker that delays its hook result past the budget cap → time_over. */
function slowWorkerFactory(fence: string, delayMs: number): WorkerFactory {
  return () => {
    const { hostSide, pluginSide } = createFakeWorkerPair();
    pluginSide.addEventListener("message", (ev) => {
      const m = ev.data as Message;
      if (m.type === "host:init") {
        pluginSide.postMessage({
          type: "plugin:ready",
          registered: [{ kind: "fence", key: fence }],
        });
      } else if (m.type === "hook:invoke") {
        setTimeout(() => {
          pluginSide.postMessage({
            type: "hook:result",
            requestId: m.requestId,
            result: { kind: "html", html: "late" },
          });
        }, delayMs);
      }
    });
    return hostSide;
  };
}

function makeOrchestratorWith(factory: WorkerFactory): {
  orch: PluginOrchestrator;
  host: PluginHost;
} {
  const host = new PluginHost({ workerFactory: factory, handshakeTimeoutMs: 100 });
  const orch = new PluginOrchestrator(host);
  return { orch, host };
}

function echoWorkerFactory(fence: string, htmlPrefix = "OK:"): WorkerFactory {
  return () => {
    const { hostSide, pluginSide } = createFakeWorkerPair();
    pluginSide.addEventListener("message", (ev) => {
      const m = ev.data as Message;
      if (m.type === "host:init") {
        pluginSide.postMessage({
          type: "plugin:ready",
          registered: [{ kind: "fence", key: fence }],
        });
      } else if (m.type === "hook:invoke") {
        pluginSide.postMessage({
          type: "hook:result",
          requestId: m.requestId,
          result: { kind: "html", html: `${htmlPrefix}${m.payload.source}` },
        });
      }
    });
    return hostSide;
  };
}

function makeOrchestrator(fence = "alert"): { orch: PluginOrchestrator; host: PluginHost } {
  const host = new PluginHost({
    workerFactory: echoWorkerFactory(fence),
    handshakeTimeoutMs: 100,
  });
  const orch = new PluginOrchestrator(host);
  return { orch, host };
}

function mockSanitizer(): void {
  setSanitizer({
    sanitize(input) {
      // strip <script> only
      return input.replace(/<script[^>]*>.*?<\/script>/gi, "");
    },
    removed: [],
  });
}

describe("PluginOrchestrator — install with local trust", () => {
  beforeEach(() => mockSanitizer());
  afterEach(() => resetSanitizer());

  it("local trust skips dialog and installs immediately", async () => {
    const { orch, host } = makeOrchestrator();
    const result = await orch.install(
      {
        manifest: manifest("p1"),
        pluginDir: "/tmp/p1",
        scope: "user",
        trustLevel: "local",
        source: "export default (s) => s",
        oneLinerSummary: "noop parser",
      },
      0,
    );
    expect(result.consent.action).toBe("skip-local");
    expect(result.handle.state).toBe("ready");
    expect(orch.trust.level("p1")).toBe("local");
    host.disposeAll();
  });

  it("local trust ignores violations (no Validator gate)", async () => {
    const { orch, host } = makeOrchestrator();
    const result = await orch.install(
      {
        manifest: manifest("p2"),
        pluginDir: "/tmp/p2",
        scope: "user",
        trustLevel: "local",
        source: "eval(x); fetch('/x');", // would be flagged for llm-generated
      },
      0,
    );
    expect(result.violations.length).toBeGreaterThan(0); // 분석은 수행
    expect(result.consent.action).toBe("skip-local"); // 그러나 local 이라 dialog skip
    expect(result.handle.state).toBe("ready");
    host.disposeAll();
  });
});

describe("PluginOrchestrator — install with llm-generated requires consent", () => {
  beforeEach(() => mockSanitizer());
  afterEach(() => resetSanitizer());

  it("llm-generated returns show action without spawning", async () => {
    const { orch, host } = makeOrchestrator();
    const result = await orch.install(
      {
        manifest: manifest("p3"),
        pluginDir: "/tmp/p3",
        scope: "user",
        trustLevel: "llm-generated",
        source: "export default (s) => s",
        oneLinerSummary: "passthrough",
        authoredBy: "claude-sonnet-4-6",
        origin: "https://example.com/p3.js",
      },
      0,
    );
    expect(result.consent.action).toBe("show");
    expect(result.consent.prompt?.trustLevel).toBe("llm-generated");
    expect(result.handle.state).toBe("loading"); // 아직 spawn 안 함
    expect(orch.trust.hasConsent("p3")).toBe(false);
    host.disposeAll();
  });

  it("resolveConsent accept spawns the plugin", async () => {
    const { orch, host } = makeOrchestrator();
    const input = {
      manifest: manifest("p4"),
      pluginDir: "/tmp/p4",
      scope: "user" as const,
      trustLevel: "llm-generated" as const,
      source: "export default (s) => s",
    };
    await orch.install(input, 0);
    const r = await orch.resolveConsent(input, "accept", 10);
    expect(r.activated).toBe(true);
    expect(r.handle?.state).toBe("ready");
    expect(orch.trust.hasConsent("p4")).toBe(true);
    host.disposeAll();
  });

  it("resolveConsent reject does not spawn", async () => {
    const { orch, host } = makeOrchestrator();
    const input = {
      manifest: manifest("p5"),
      pluginDir: "/tmp/p5",
      scope: "user" as const,
      trustLevel: "llm-generated" as const,
      source: "export default (s) => s",
    };
    await orch.install(input, 0);
    const r = await orch.resolveConsent(input, "reject", 10);
    expect(r.activated).toBe(false);
    expect(r.handle).toBeUndefined();
    expect(orch.trust.hasConsent("p5")).toBe(false);
    host.disposeAll();
  });
});

describe("PluginOrchestrator — render with budget + sanitize", () => {
  beforeEach(() => mockSanitizer());
  afterEach(() => resetSanitizer());

  it("renders fence and sanitizes output (local trust = relaxed)", async () => {
    const { orch, host } = makeOrchestrator("alert");
    await orch.install(
      {
        manifest: manifest("p6", "alert"),
        pluginDir: "/tmp/p6",
        scope: "user",
        trustLevel: "local",
        source: "x",
      },
      0,
    );
    const out = await orch.render({
      pluginName: "p6",
      kind: "fence",
      key: "alert",
      source: "hello",
      context: { documentPath: "/doc.md" },
    });
    expect(out.errorMessage).toBeNull();
    expect(out.html).toBe("OK:hello");
    expect(out.budget.suspended).toBe(false);
    host.disposeAll();
  });

  it("publishStrict forces strict sanitization regardless of trust level", async () => {
    const { orch, host } = makeOrchestrator("alert");
    await orch.install(
      {
        manifest: manifest("p7", "alert"),
        pluginDir: "/tmp/p7",
        scope: "user",
        trustLevel: "local",
        source: "x",
      },
      0,
    );
    const out = await orch.render({
      pluginName: "p7",
      kind: "fence",
      key: "alert",
      source: "<script>alert(1)</script>hi",
      context: { documentPath: "/doc.md" },
      publishStrict: true,
    });
    expect(out.errorMessage).toBeNull();
    // mock sanitizer strips script
    expect(out.html).not.toContain("<script>");
    expect(out.html).toContain("OK:");
    host.disposeAll();
  });

  it("reports null for unknown fence", async () => {
    const { orch, host } = makeOrchestrator("alert");
    await orch.install(
      {
        manifest: manifest("p8", "alert"),
        pluginDir: "/tmp/p8",
        scope: "user",
        trustLevel: "local",
        source: "x",
      },
      0,
    );
    const out = await orch.render({
      pluginName: "p8",
      kind: "fence",
      key: "doesnotexist",
      source: "hi",
      context: { documentPath: "/doc.md" },
    });
    expect(out.html).toBeNull();
    expect(out.errorMessage).toBe("no result");
    host.disposeAll();
  });

  it("dispatches codeblock kind via host.renderCodeblock", async () => {
    const { orch, host } = makeOrchestratorWith(codeblockWorkerFactory("wireweave"));
    await orch.install(
      {
        manifest: codeblockManifest("cb1", "wireweave"),
        pluginDir: "/tmp/cb1",
        scope: "user",
        trustLevel: "local",
        source: "x",
      },
      0,
    );
    const out = await orch.render({
      pluginName: "cb1",
      kind: "codeblock",
      key: "wireweave",
      source: "graph",
      context: { documentPath: "/doc.md" },
      readMemory: () => 1024, // exercises measureOpts.readMemory wiring
    });
    expect(out.errorMessage).toBeNull();
    expect(out.html).toBe("CB:graph");
    expect(out.budget.suspended).toBe(false);
    host.disposeAll();
  });

  it("propagates plugin error result as errorMessage", async () => {
    const { orch, host } = makeOrchestratorWith(errorResultWorkerFactory("alert"));
    await orch.install(
      {
        manifest: manifest("perr", "alert"),
        pluginDir: "/tmp/perr",
        scope: "user",
        trustLevel: "local",
        source: "x",
      },
      0,
    );
    const out = await orch.render({
      pluginName: "perr",
      kind: "fence",
      key: "alert",
      source: "hi",
      context: { documentPath: "/doc.md" },
    });
    expect(out.html).toBeNull();
    expect(out.errorMessage).toBe("render blew up");
    expect(out.budget.suspended).toBe(false);
    host.disposeAll();
  });

  it("suspends when the hook exceeds the time budget", async () => {
    // publishStrict cap = 50ms; worker replies after 120ms → time_over.
    const { orch, host } = makeOrchestratorWith(slowWorkerFactory("alert", 120));
    await orch.install(
      {
        manifest: manifest("pslow", "alert"),
        pluginDir: "/tmp/pslow",
        scope: "user",
        trustLevel: "local",
        source: "x",
      },
      0,
    );
    const out = await orch.render({
      pluginName: "pslow",
      kind: "fence",
      key: "alert",
      source: "hi",
      context: { documentPath: "/doc.md" },
      publishStrict: true,
    });
    expect(out.html).toBeNull();
    expect(out.budget.suspended).toBe(true);
    expect(out.budget.code).toBe("time_over");
    expect(out.errorMessage).toContain("pslow");
    expect(out.errorMessage).toContain("time_over");
    host.disposeAll();
  });
});
