// Edge branch coverage for PluginOrchestrator.render: the
// `outcome.durationMs !== undefined ? ... : {}` arms (lines 166/170/180/197).
//
// `measureAsync` always populates `durationMs` in practice, so these false
// arms are only reachable by stubbing the BudgetGuard. We mock the module
// so each `render()` receives an outcome with `durationMs` absent.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { resetSanitizer, setSanitizer } from "../../../preview/sanitizer";
import type { GuardOutcome } from "../budget-guard";
import { PluginHost, type WorkerFactory } from "../host";
import { PluginOrchestrator } from "../orchestrator";
import { type Message, createFakeWorkerPair } from "../sandbox-rpc";
import type { PluginManifest } from "../types";

// Controls what the mocked measureAsync returns per call.
let nextOutcome: GuardOutcome = { code: "ok", shouldSuspend: false };
let nextResult: unknown = null;

vi.mock("../budget-guard", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../budget-guard")>();
  return {
    ...actual,
    measureAsync: vi.fn(async (_spec, fn: () => Promise<unknown>) => {
      // Still run the dispatch so the host RPC path executes when needed.
      const result = nextResult === "__run__" ? await fn() : nextResult;
      return { result, outcome: nextOutcome };
    }),
  };
});

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

function echoWorkerFactory(fence: string): WorkerFactory {
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
          result: { kind: "html", html: `OK:${m.payload.source}` },
        });
      }
    });
    return hostSide;
  };
}

async function setup(): Promise<{ orch: PluginOrchestrator; host: PluginHost }> {
  const host = new PluginHost({
    workerFactory: echoWorkerFactory("alert"),
    handshakeTimeoutMs: 100,
  });
  const orch = new PluginOrchestrator(host);
  await orch.install(
    {
      manifest: manifest("dp"),
      pluginDir: "/tmp/dp",
      scope: "user",
      trustLevel: "local",
      source: "x",
    },
    0,
  );
  return { orch, host };
}

const baseReq = {
  pluginName: "dp",
  kind: "fence" as const,
  key: "alert",
  source: "hi",
  context: { documentPath: "/doc.md" },
};

beforeEach(() => {
  setSanitizer({ sanitize: (input) => input, removed: [] });
});
afterEach(() => resetSanitizer());

describe("render — durationMs undefined (suspend path, lines 166/170)", () => {
  it("omits durationMs and shows '?' in the error message when undefined", async () => {
    const { orch, host } = await setup();
    nextOutcome = { code: "time_over", shouldSuspend: true }; // no durationMs
    nextResult = null;
    const out = await orch.render(baseReq);
    expect(out.budget.suspended).toBe(true);
    expect(out.budget.durationMs).toBeUndefined();
    expect(out.errorMessage).toContain("?ms");
    host.disposeAll();
  });
});

describe("render — durationMs undefined (no-result path, line 180)", () => {
  it("omits durationMs in budget for a non-html result", async () => {
    const { orch, host } = await setup();
    nextOutcome = { code: "ok", shouldSuspend: false }; // no durationMs
    nextResult = { kind: "error", message: "nope" };
    const out = await orch.render(baseReq);
    expect(out.html).toBeNull();
    expect(out.errorMessage).toBe("nope");
    expect(out.budget.durationMs).toBeUndefined();
    host.disposeAll();
  });
});

describe("render — durationMs undefined (html path, line 197)", () => {
  it("omits durationMs in budget for a sanitized html result", async () => {
    const { orch, host } = await setup();
    nextOutcome = { code: "ok", shouldSuspend: false }; // no durationMs
    nextResult = { kind: "html", html: "<b>hi</b>" };
    const out = await orch.render(baseReq);
    expect(out.errorMessage).toBeNull();
    expect(out.html).toBe("<b>hi</b>");
    expect(out.budget.durationMs).toBeUndefined();
    host.disposeAll();
  });
});
