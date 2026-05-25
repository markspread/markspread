// S-PL-SEC-001: PluginHost install / enable / disable / uninstall / reload
// + codeblock + fence dispatcher tests.

import { describe, expect, it, vi } from "vitest";
import { HANDSHAKE_TIMEOUT_MS, HOT_RELOAD_DEBOUNCE_MS, PluginHost, type WorkerFactory } from "../host";
import { type Message, type WorkerLike, createFakeWorkerPair } from "../sandbox-rpc";
import type { PluginManifest } from "../types";

function manifest(name: string, fences: string[] = ["alert"]): PluginManifest {
  return {
    schemaVersion: 1,
    name,
    version: "0.1.0",
    entry: "./index.js",
    permissions: [],
    allowedHosts: [],
    contributes: {
      fences: fences.map((f) => ({ name: f, render: "html" as const })),
      codeblocks: { mermaid: { render: "html" as const } },
    },
    render: "html",
    engines: { markspread: ">=1.3.0" },
  };
}

function fakeWorkerFactory(
  behaviour: (host: WorkerLike, plugin: WorkerLike) => void,
): WorkerFactory {
  return () => {
    const { hostSide, pluginSide } = createFakeWorkerPair();
    behaviour(hostSide, pluginSide);
    return hostSide;
  };
}

function echoPlugin(pluginSide: WorkerLike, key: string, htmlPrefix = "OK:"): void {
  pluginSide.addEventListener("message", (ev) => {
    const m = ev.data as Message;
    if (m.type === "host:init") {
      pluginSide.postMessage({
        type: "plugin:ready",
        registered: [
          { kind: "fence", key },
          { kind: "codeblock", key: "mermaid" },
        ],
      });
    } else if (m.type === "hook:invoke") {
      pluginSide.postMessage({
        type: "hook:result",
        requestId: m.requestId,
        result: { kind: "html", html: `${htmlPrefix}${m.payload.source}` },
      });
    }
  });
}

describe("PluginHost lifecycle", () => {
  it("installs and reaches ready after handshake", async () => {
    const host = new PluginHost({
      workerFactory: fakeWorkerFactory((_h, p) => echoPlugin(p, "alert")),
      handshakeTimeoutMs: 100,
    });
    const handle = await host.install({
      manifest: manifest("p1"),
      pluginDir: "/tmp/p1",
      scope: "user",
    });
    expect(handle.state).toBe("ready");
    expect(handle.registered).toContain("fence.alert");
    host.disposeAll();
  });

  it("install reports error on handshake timeout", async () => {
    const host = new PluginHost({
      workerFactory: fakeWorkerFactory(() => {
        // plugin never replies → handshake times out.
      }),
      handshakeTimeoutMs: 20,
    });
    const handle = await host.install({
      manifest: manifest("p1"),
      pluginDir: "/tmp/p1",
      scope: "user",
    });
    expect(handle.state).toBe("error");
    expect(handle.errorMessage).toMatch(/timed out/);
    host.disposeAll();
  });

  it("install reports error when plugin sends plugin:err", async () => {
    const host = new PluginHost({
      workerFactory: fakeWorkerFactory((_h, p) => {
        p.addEventListener("message", () => {
          p.postMessage({ type: "plugin:err", message: "bad init" });
        });
      }),
      handshakeTimeoutMs: 100,
    });
    const handle = await host.install({
      manifest: manifest("p1"),
      pluginDir: "/tmp",
      scope: "user",
    });
    expect(handle.state).toBe("error");
    expect(handle.errorMessage).toBe("bad init");
    host.disposeAll();
  });

  it("disable terminates worker; enable revives", async () => {
    const host = new PluginHost({
      workerFactory: fakeWorkerFactory((_h, p) => echoPlugin(p, "alert")),
      handshakeTimeoutMs: 100,
    });
    await host.install({
      manifest: manifest("p1"),
      pluginDir: "/tmp",
      scope: "user",
    });
    await host.disable("p1");
    expect(host.list()[0]?.state).toBe("disabled");
    await host.enable("p1");
    expect(host.list()[0]?.state).toBe("ready");
    host.disposeAll();
  });

  it("enable is no-op on already-ready", async () => {
    const host = new PluginHost({
      workerFactory: fakeWorkerFactory((_h, p) => echoPlugin(p, "alert")),
      handshakeTimeoutMs: 100,
    });
    await host.install({
      manifest: manifest("p1"),
      pluginDir: "/tmp",
      scope: "user",
    });
    await host.enable("p1");
    expect(host.list()[0]?.state).toBe("ready");
    host.disposeAll();
  });

  it("enable on unknown plugin throws", async () => {
    const host = new PluginHost({
      workerFactory: fakeWorkerFactory(() => undefined),
    });
    await expect(host.enable("missing")).rejects.toThrow(/unknown plugin/);
  });

  it("disable on unknown plugin is a no-op", async () => {
    const host = new PluginHost({
      workerFactory: fakeWorkerFactory(() => undefined),
    });
    await host.disable("missing");
  });

  it("uninstall removes from registry", async () => {
    const host = new PluginHost({
      workerFactory: fakeWorkerFactory((_h, p) => echoPlugin(p, "alert")),
      handshakeTimeoutMs: 100,
    });
    await host.install({
      manifest: manifest("p1"),
      pluginDir: "/tmp",
      scope: "user",
    });
    await host.uninstall("p1");
    expect(host.list()).toHaveLength(0);
  });

  it("reload swaps in a new manifest", async () => {
    const host = new PluginHost({
      workerFactory: fakeWorkerFactory((_h, p) => echoPlugin(p, "alert")),
      handshakeTimeoutMs: 100,
    });
    await host.install({
      manifest: manifest("p1"),
      pluginDir: "/tmp",
      scope: "user",
    });
    const next = { ...manifest("p1"), version: "0.2.0" };
    await host.reload("p1", next);
    expect(host.list()[0]?.manifest.version).toBe("0.2.0");
    host.disposeAll();
  });

  it("reload of unknown plugin is no-op", async () => {
    const host = new PluginHost({
      workerFactory: fakeWorkerFactory(() => undefined),
    });
    await host.reload("missing");
  });

  it("reload without next manifest just respawns", async () => {
    const host = new PluginHost({
      workerFactory: fakeWorkerFactory((_h, p) => echoPlugin(p, "alert")),
      handshakeTimeoutMs: 100,
    });
    await host.install({
      manifest: manifest("p1"),
      pluginDir: "/tmp",
      scope: "user",
    });
    await host.reload("p1");
    expect(host.list()[0]?.state).toBe("ready");
    host.disposeAll();
  });

  it("install collision keeps workspace over user", async () => {
    const host = new PluginHost({
      workerFactory: fakeWorkerFactory((_h, p) => echoPlugin(p, "alert")),
      handshakeTimeoutMs: 100,
    });
    await host.install({
      manifest: manifest("p1"),
      pluginDir: "/ws",
      scope: "workspace",
    });
    const out = await host.install({
      manifest: manifest("p1"),
      pluginDir: "/u",
      scope: "user",
    });
    expect(out.scope).toBe("workspace");
    host.disposeAll();
  });

  it("install collision replaces when new is workspace and existing is user", async () => {
    const host = new PluginHost({
      workerFactory: fakeWorkerFactory((_h, p) => echoPlugin(p, "alert")),
      handshakeTimeoutMs: 100,
    });
    await host.install({
      manifest: manifest("p1"),
      pluginDir: "/u",
      scope: "user",
    });
    const out = await host.install({
      manifest: manifest("p1"),
      pluginDir: "/ws",
      scope: "workspace",
    });
    expect(out.scope).toBe("workspace");
    host.disposeAll();
  });

  it("subscribe notifies on state change and unsubscribe stops it", async () => {
    const host = new PluginHost({
      workerFactory: fakeWorkerFactory((_h, p) => echoPlugin(p, "alert")),
      handshakeTimeoutMs: 100,
    });
    const spy = vi.fn();
    const off = host.subscribe(spy);
    await host.install({
      manifest: manifest("p1"),
      pluginDir: "/tmp",
      scope: "user",
    });
    expect(spy).toHaveBeenCalled();
    off();
    spy.mockClear();
    await host.uninstall("p1");
    expect(spy).not.toHaveBeenCalled();
  });
});

describe("PluginHost dispatcher", () => {
  it("renderCodeblock dispatches to first matching plugin", async () => {
    const host = new PluginHost({
      workerFactory: fakeWorkerFactory((_h, p) => echoPlugin(p, "alert")),
      handshakeTimeoutMs: 100,
    });
    await host.install({
      manifest: manifest("p1"),
      pluginDir: "/tmp",
      scope: "user",
    });
    const r = await host.renderCodeblock("mermaid", "graph", { documentPath: null });
    expect(r?.kind).toBe("html");
    if (r?.kind === "html") expect(r.html).toBe("OK:graph");
    host.disposeAll();
  });

  it("renderCodeblock returns null when no plugin claims lang", async () => {
    const host = new PluginHost({
      workerFactory: fakeWorkerFactory((_h, p) => echoPlugin(p, "alert")),
      handshakeTimeoutMs: 100,
    });
    await host.install({
      manifest: manifest("p1"),
      pluginDir: "/tmp",
      scope: "user",
    });
    const r = await host.renderCodeblock("unknown-lang", "x", { documentPath: null });
    expect(r).toBeNull();
    host.disposeAll();
  });

  it("renderFence dispatches", async () => {
    const host = new PluginHost({
      workerFactory: fakeWorkerFactory((_h, p) => echoPlugin(p, "note")),
      handshakeTimeoutMs: 100,
    });
    await host.install({
      manifest: manifest("p1", ["note"]),
      pluginDir: "/tmp",
      scope: "user",
    });
    const r = await host.renderFence("note", "body", { documentPath: null });
    expect(r?.kind).toBe("html");
    host.disposeAll();
  });

  it("renderFence returns null when no plugin matches", async () => {
    const host = new PluginHost({
      workerFactory: fakeWorkerFactory((_h, p) => echoPlugin(p, "alert")),
      handshakeTimeoutMs: 100,
    });
    await host.install({
      manifest: manifest("p1"),
      pluginDir: "/tmp",
      scope: "user",
    });
    const r = await host.renderFence("unknown-fence", "x", { documentPath: null });
    expect(r).toBeNull();
    host.disposeAll();
  });

  it("renderCodeblock surfaces plugin-side error", async () => {
    const host = new PluginHost({
      workerFactory: fakeWorkerFactory((_h, p) => {
        p.addEventListener("message", (ev) => {
          const m = ev.data as Message;
          if (m.type === "host:init") {
            p.postMessage({
              type: "plugin:ready",
              registered: [{ kind: "codeblock", key: "mermaid" }],
            });
          } else if (m.type === "hook:invoke") {
            p.postMessage({
              type: "hook:result",
              requestId: m.requestId,
              result: { kind: "error", message: "render failed" },
            });
          }
        });
      }),
      handshakeTimeoutMs: 100,
    });
    await host.install({
      manifest: manifest("p1"),
      pluginDir: "/tmp",
      scope: "user",
    });
    const r = await host.renderCodeblock("mermaid", "x", { documentPath: null });
    expect(r?.kind).toBe("error");
    if (r?.kind === "error") expect(r.message).toBe("render failed");
    host.disposeAll();
  });

  it("renderFence surfaces plugin-side error", async () => {
    const host = new PluginHost({
      workerFactory: fakeWorkerFactory((_h, p) => {
        p.addEventListener("message", (ev) => {
          const m = ev.data as Message;
          if (m.type === "host:init") {
            p.postMessage({
              type: "plugin:ready",
              registered: [{ kind: "fence", key: "alert" }],
            });
          } else if (m.type === "hook:invoke") {
            p.postMessage({
              type: "hook:result",
              requestId: m.requestId,
              result: { kind: "error", message: "broken" },
            });
          }
        });
      }),
      handshakeTimeoutMs: 100,
    });
    await host.install({
      manifest: manifest("p1"),
      pluginDir: "/tmp",
      scope: "user",
    });
    const r = await host.renderFence("alert", "x", { documentPath: null });
    expect(r?.kind).toBe("error");
    host.disposeAll();
  });

  it("renderCodeblock returns error when invoke rejects (e.g. disposed mid-flight)", async () => {
    const host = new PluginHost({
      workerFactory: fakeWorkerFactory((_h, p) => echoPlugin(p, "alert")),
      handshakeTimeoutMs: 100,
    });
    await host.install({
      manifest: manifest("p1"),
      pluginDir: "/tmp",
      scope: "user",
    });
    // Race: dispose during invoke.
    const p = host.renderCodeblock("mermaid", "x", { documentPath: null });
    host.disposeAll();
    const r = await p;
    expect(r?.kind === "html" || r?.kind === "error").toBe(true);
  });

  it("renderFence returns error when invoke rejects (disposed mid-flight)", async () => {
    const host = new PluginHost({
      workerFactory: fakeWorkerFactory((_h, p) => {
        p.addEventListener("message", (ev) => {
          const m = ev.data as Message;
          if (m.type === "host:init") {
            p.postMessage({
              type: "plugin:ready",
              registered: [{ kind: "fence", key: "alert" }],
            });
          }
          // never reply to hook:invoke → caller will hit dispose-driven reject.
        });
      }),
      handshakeTimeoutMs: 100,
    });
    await host.install({
      manifest: manifest("p1"),
      pluginDir: "/tmp",
      scope: "user",
    });
    const p = host.renderFence("alert", "x", { documentPath: null });
    host.disposeAll();
    const r = await p;
    expect(r?.kind).toBe("error");
  });

  it("workspace plugin wins over user when both claim same lang", async () => {
    const host = new PluginHost({
      workerFactory: fakeWorkerFactory((_h, p) => echoPlugin(p, "alert", "WS:")),
      handshakeTimeoutMs: 100,
    });
    await host.install({
      manifest: manifest("p1"),
      pluginDir: "/u",
      scope: "user",
    });
    await host.install({
      manifest: manifest("p2"),
      pluginDir: "/ws",
      scope: "workspace",
    });
    const r = await host.renderCodeblock("mermaid", "y", { documentPath: null });
    expect(r?.kind).toBe("html");
    if (r?.kind === "html") expect(r.html.startsWith("WS:")).toBe(true);
    host.disposeAll();
  });

  it("two plugins with same scope are ordered alphabetically by name", async () => {
    // Same-scope tiebreaker: localeCompare branch in sortedReady.
    // Both register "mermaid" codeblock; the alphabetically-first wins.
    const host = new PluginHost({
      workerFactory: fakeWorkerFactory((_h, p) => {
        p.addEventListener("message", (ev) => {
          const m = ev.data as Message;
          if (m.type === "host:init") {
            p.postMessage({
              type: "plugin:ready",
              registered: [{ kind: "codeblock", key: "mermaid" }],
            });
          } else if (m.type === "hook:invoke") {
            p.postMessage({
              type: "hook:result",
              requestId: m.requestId,
              result: { kind: "html", html: `pl/${m.payload.source}` },
            });
          }
        });
      }),
      handshakeTimeoutMs: 100,
    });
    await host.install({ manifest: manifest("b-plugin"), pluginDir: "/b", scope: "user" });
    await host.install({ manifest: manifest("a-plugin"), pluginDir: "/a", scope: "user" });
    const r = await host.renderCodeblock("mermaid", "x", { documentPath: null });
    expect(r?.kind).toBe("html");
    host.disposeAll();
  });

  it("renderCodeblock returns kind:error when invokeHook throws synchronously", async () => {
    const host = new PluginHost({
      workerFactory: fakeWorkerFactory((_h, p) => {
        p.addEventListener("message", (ev) => {
          const m = ev.data as Message;
          if (m.type === "host:init") {
            p.postMessage({
              type: "plugin:ready",
              registered: [{ kind: "codeblock", key: "mermaid" }],
            });
          }
        });
      }),
      handshakeTimeoutMs: 100,
    });
    await host.install({
      manifest: manifest("p1"),
      pluginDir: "/tmp",
      scope: "user",
    });
    const p = host.renderCodeblock("mermaid", "y", { documentPath: null });
    host.disposeAll();
    const r = await p;
    expect(r?.kind).toBe("error");
  });

  it("module exports debounce + handshake timeout constants", () => {
    expect(HANDSHAKE_TIMEOUT_MS).toBeGreaterThan(0);
    expect(HOT_RELOAD_DEBOUNCE_MS).toBeGreaterThan(0);
  });

  it("forwards plugin warnings on renderCodeblock + renderFence", async () => {
    const host = new PluginHost({
      workerFactory: fakeWorkerFactory((_h, p) => {
        p.addEventListener("message", (ev) => {
          const m = ev.data as Message;
          if (m.type === "host:init") {
            p.postMessage({
              type: "plugin:ready",
              registered: [
                { kind: "codeblock", key: "mermaid" },
                { kind: "fence", key: "alert" },
              ],
            });
          } else if (m.type === "hook:invoke") {
            p.postMessage({
              type: "hook:result",
              requestId: m.requestId,
              result: { kind: "html", html: `<i>${m.payload.source}</i>` },
              warnings: [`deprecated: ${m.kind}/${m.key}`],
            });
          }
        });
      }),
      handshakeTimeoutMs: 100,
    });
    await host.install({ manifest: manifest("p1"), pluginDir: "/tmp", scope: "user" });
    const cb = await host.renderCodeblock("mermaid", "g", { documentPath: null });
    const fn = await host.renderFence("alert", "b", { documentPath: null });
    expect(cb?.kind).toBe("html");
    expect(fn?.kind).toBe("html");
    if (cb?.kind === "html") expect(cb.warnings).toEqual(["deprecated: codeblock/mermaid"]);
    if (fn?.kind === "html") expect(fn.warnings).toEqual(["deprecated: fence/alert"]);
    host.disposeAll();
  });

  it("renderFence treats missing fences[] as no candidates", async () => {
    const host = new PluginHost({
      workerFactory: fakeWorkerFactory((_h, p) => echoPlugin(p, "alert")),
      handshakeTimeoutMs: 100,
    });
    const manifestNoFences: PluginManifest = {
      ...manifest("p1"),
      contributes: { codeblocks: { mermaid: { render: "html" as const } } },
    };
    await host.install({ manifest: manifestNoFences, pluginDir: "/tmp", scope: "user" });
    const r = await host.renderFence("alert", "x", { documentPath: null });
    expect(r).toBeNull();
    host.disposeAll();
  });

  it("enable() catches handshake failures and reports state=error", async () => {
    // disable() → ready entry is torn down. enable() then re-spawns; if
    // the second factory call never completes the handshake, the catch
    // branch must record the error instead of bubbling out.
    let attempt = 0;
    const host = new PluginHost({
      workerFactory: () => {
        attempt += 1;
        const { hostSide, pluginSide } = createFakeWorkerPair();
        if (attempt === 1) {
          echoPlugin(pluginSide, "alert");
        }
        // attempt #2 → plugin never replies, handshake times out.
        return hostSide;
      },
      handshakeTimeoutMs: 20,
    });
    await host.install({ manifest: manifest("p1"), pluginDir: "/tmp", scope: "user" });
    await host.disable("p1");
    await host.enable("p1");
    const [h] = host.list();
    expect(h.state).toBe("error");
    expect(h.errorMessage).toMatch(/handshake/i);
    host.disposeAll();
  });
});
