// S-PL-SEC-001: sandbox-rpc round-trip + timeout / cancel / dispose tests.

import { describe, expect, it, vi } from "vitest";
import {
  type HookInvoke,
  type HostInit,
  type Message,
  SandboxRpc,
  type WorkerLike,
  createFakeWorkerPair,
} from "../sandbox-rpc";

function makePluginEcho(pluginSide: WorkerLike): void {
  // 단순 echo: hook:invoke 가 오면 같은 source 를 html 로 감싸 반환.
  pluginSide.addEventListener("message", (ev) => {
    const msg = ev.data as Message;
    if (msg.type === "host:init") {
      pluginSide.postMessage({
        type: "plugin:ready",
        registered: [{ kind: "fence", key: "note" }],
      });
    } else if (msg.type === "hook:invoke") {
      pluginSide.postMessage({
        type: "hook:result",
        requestId: msg.requestId,
        result: { kind: "html", html: `<p>${msg.payload.source}</p>` },
        warnings: ["w"],
      });
    }
  });
}

describe("SandboxRpc round-trip", () => {
  it("delivers handshake (plugin:ready) to listener", async () => {
    const { hostSide, pluginSide } = createFakeWorkerPair();
    makePluginEcho(pluginSide);
    const rpc = new SandboxRpc(hostSide);
    const seen = await new Promise<Message>((resolve) => {
      rpc.on((m) => resolve(m));
      rpc.postInit({
        type: "host:init",
        pluginName: "demo",
        capabilities: { permissions: [], allowedHosts: [] },
      });
    });
    expect(seen.type).toBe("plugin:ready");
    rpc.dispose();
  });

  it("correlates hook:invoke with hook:result by requestId", async () => {
    const { hostSide, pluginSide } = createFakeWorkerPair();
    makePluginEcho(pluginSide);
    const rpc = new SandboxRpc(hostSide);
    const result = await rpc.invokeHook("fence", "note", { source: "hi", documentPath: null });
    expect(result.result.kind).toBe("html");
    if (result.result.kind === "html") expect(result.result.html).toBe("<p>hi</p>");
    rpc.dispose();
  });

  it("rejects pending RPCs on dispose", async () => {
    const { hostSide } = createFakeWorkerPair();
    const rpc = new SandboxRpc(hostSide);
    const p = rpc.invokeHook("fence", "note", { source: "x", documentPath: null });
    rpc.dispose();
    await expect(p).rejects.toThrow(/disposed/);
  });

  it("dispose after dispose is a no-op", () => {
    const { hostSide } = createFakeWorkerPair();
    const rpc = new SandboxRpc(hostSide);
    rpc.dispose();
    expect(() => rpc.dispose()).not.toThrow();
  });

  it("rejects invoke after dispose", async () => {
    const { hostSide } = createFakeWorkerPair();
    const rpc = new SandboxRpc(hostSide);
    rpc.dispose();
    await expect(rpc.invokeHook("fence", "x", { source: "", documentPath: null })).rejects.toThrow(
      /disposed/,
    );
  });

  it("throws on postInit after dispose", () => {
    const { hostSide } = createFakeWorkerPair();
    const rpc = new SandboxRpc(hostSide);
    rpc.dispose();
    expect(() =>
      rpc.postInit({
        type: "host:init",
        pluginName: "x",
        capabilities: { permissions: [], allowedHosts: [] },
      }),
    ).toThrow(/disposed/);
  });

  it("times out when plugin never responds", async () => {
    const { hostSide } = createFakeWorkerPair();
    const rpc = new SandboxRpc(hostSide);
    const p = rpc.invokeHook("fence", "x", { source: "", documentPath: null }, { timeoutMs: 10 });
    await expect(p).rejects.toThrow(/timed out/);
    rpc.dispose();
  });

  it("supports AbortSignal cancellation pre-flight", async () => {
    const { hostSide } = createFakeWorkerPair();
    const rpc = new SandboxRpc(hostSide);
    const ctrl = new AbortController();
    ctrl.abort();
    const p = rpc.invokeHook(
      "fence",
      "x",
      { source: "", documentPath: null },
      { signal: ctrl.signal },
    );
    await expect(p).rejects.toThrow(/aborted/);
    rpc.dispose();
  });

  it("supports AbortSignal cancellation mid-flight", async () => {
    const { hostSide } = createFakeWorkerPair();
    const rpc = new SandboxRpc(hostSide);
    const ctrl = new AbortController();
    const p = rpc.invokeHook(
      "fence",
      "x",
      { source: "", documentPath: null },
      { signal: ctrl.signal },
    );
    ctrl.abort();
    await expect(p).rejects.toThrow(/aborted/);
    rpc.dispose();
  });

  it("rejects schema-bad incoming messages silently", async () => {
    const { hostSide, pluginSide } = createFakeWorkerPair();
    const rpc = new SandboxRpc(hostSide);
    const spy = vi.fn();
    rpc.on(spy);
    // Send a malformed message — should be dropped without throwing or notifying.
    pluginSide.postMessage({ type: "unknown", garbage: true });
    await Promise.resolve();
    expect(spy).not.toHaveBeenCalled();
    rpc.dispose();
  });

  it("ignores hook:result with unknown requestId", async () => {
    const { hostSide, pluginSide } = createFakeWorkerPair();
    const rpc = new SandboxRpc(hostSide);
    pluginSide.postMessage({
      type: "hook:result",
      requestId: "nonexistent",
      result: { kind: "html", html: "<p>x</p>" },
    });
    await Promise.resolve();
    // No throw is the assertion.
    rpc.dispose();
  });

  it("listener unsubscribe stops further notifications", async () => {
    const { hostSide, pluginSide } = createFakeWorkerPair();
    const rpc = new SandboxRpc(hostSide);
    const spy = vi.fn();
    const off = rpc.on(spy);
    off();
    pluginSide.postMessage({
      type: "plugin:ready",
      registered: [],
    });
    await Promise.resolve();
    expect(spy).not.toHaveBeenCalled();
    rpc.dispose();
  });

  it("forwards plugin:err via listener", async () => {
    const { hostSide, pluginSide } = createFakeWorkerPair();
    const rpc = new SandboxRpc(hostSide);
    const got = new Promise<Message>((resolve) => rpc.on(resolve));
    pluginSide.postMessage({ type: "plugin:err", message: "boom" });
    const m = await got;
    expect(m.type).toBe("plugin:err");
    rpc.dispose();
  });

  it("plugin can read message back via fake pair both ways", async () => {
    const { hostSide, pluginSide } = createFakeWorkerPair();
    const pluginGot = new Promise<unknown>((resolve) => {
      pluginSide.addEventListener("message", (ev) => resolve(ev.data));
    });
    const init: HostInit = {
      type: "host:init",
      pluginName: "x",
      capabilities: { permissions: [], allowedHosts: [] },
    };
    hostSide.postMessage(init);
    const got = (await pluginGot) as HostInit;
    expect(got.type).toBe("host:init");
  });

  it("invokeHook posts correct shape to worker", async () => {
    const { hostSide, pluginSide } = createFakeWorkerPair();
    const got = new Promise<HookInvoke>((resolve) => {
      pluginSide.addEventListener("message", (ev) => resolve(ev.data as HookInvoke));
    });
    const rpc = new SandboxRpc(hostSide);
    const pending = rpc.invokeHook(
      "codeblock",
      "mermaid",
      { source: "graph TD;A-->B", documentPath: "/a.md" },
      { timeoutMs: 50 },
    );
    // attach a catch handler so dispose-driven rejection is not "unhandled".
    pending.catch(() => undefined);
    const m = await got;
    expect(m.type).toBe("hook:invoke");
    expect(m.kind).toBe("codeblock");
    expect(m.key).toBe("mermaid");
    expect(m.payload.source).toContain("graph");
    rpc.dispose();
  });

  it("postMessage to disposed fake pair is silently dropped", () => {
    const { hostSide, pluginSide } = createFakeWorkerPair();
    pluginSide.terminate();
    expect(() => hostSide.postMessage({ x: 1 })).not.toThrow();
  });

  it("dispose swallows worker.terminate() exceptions", () => {
    // Some embeddings (e.g. closed iframe) throw from terminate; we never
    // want that to bubble out of dispose() — caller can't act on it.
    const worker: WorkerLike = {
      postMessage: () => undefined,
      addEventListener: () => undefined,
      removeEventListener: () => undefined,
      terminate: () => {
        throw new Error("boom");
      },
    };
    const rpc = new SandboxRpc(worker);
    expect(() => rpc.dispose()).not.toThrow();
  });

  it("fake pair pluginSide removeEventListener detaches the listener", () => {
    const { hostSide, pluginSide } = createFakeWorkerPair();
    const seen: unknown[] = [];
    const listener = (ev: { data: unknown }) => seen.push(ev.data);
    pluginSide.addEventListener("message", listener);
    hostSide.postMessage({ a: 1 });
    pluginSide.removeEventListener("message", listener);
    hostSide.postMessage({ a: 2 });
    expect(seen).toEqual([{ a: 1 }]);
  });

  it("pluginSide.postMessage no-ops once the pair is terminated", () => {
    const { hostSide, pluginSide } = createFakeWorkerPair();
    const seen: unknown[] = [];
    hostSide.addEventListener("message", (ev) => seen.push(ev.data));
    pluginSide.terminate();
    expect(() => pluginSide.postMessage({ x: 1 })).not.toThrow();
    expect(seen).toEqual([]);
  });

  it("settleReject is a no-op if the request entry already resolved", async () => {
    // Reproduces the race where an AbortController fires *after* the
    // hook:result message already resolved the pending promise — the
    // signal listener calls settleReject(requestId) with no entry.
    const { hostSide, pluginSide } = createFakeWorkerPair();
    const rpc = new SandboxRpc(hostSide);
    pluginSide.addEventListener("message", (ev) => {
      const m = ev.data as Message;
      if (m.type === "hook:invoke") {
        pluginSide.postMessage({
          type: "hook:result",
          requestId: m.requestId,
          result: { kind: "html", html: "x" },
        });
      }
    });
    const ac = new AbortController();
    const got = await rpc.invokeHook(
      "codeblock",
      "k",
      { source: "s", documentPath: null },
      { signal: ac.signal },
    );
    expect(got.type).toBe("hook:result");
    expect(() => ac.abort()).not.toThrow();
    rpc.dispose();
  });
});
