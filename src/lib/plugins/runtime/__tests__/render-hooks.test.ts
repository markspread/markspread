// S-PL-SEC-001: render-hooks visitor selection + dispatcher integration.

import { describe, expect, it } from "vitest";
import { PluginHost } from "../host";
import { applyPluginHooks } from "../render-hooks";
import { type Message, type WorkerLike, createFakeWorkerPair } from "../sandbox-rpc";
import type { PluginManifest } from "../types";

function manifest(
  name: string,
  opts: { fences?: string[]; codeblocks?: string[] } = {},
): PluginManifest {
  return {
    schemaVersion: 1,
    name,
    version: "0.1.0",
    entry: "./index.js",
    permissions: [],
    allowedHosts: [],
    contributes: {
      ...(opts.fences
        ? { fences: opts.fences.map((f) => ({ name: f, render: "html" as const })) }
        : {}),
      ...(opts.codeblocks
        ? {
            codeblocks: Object.fromEntries(
              opts.codeblocks.map((c) => [c, { render: "html" as const }]),
            ),
          }
        : {}),
    },
    render: "html",
    engines: { markspread: ">=1.3.0" },
  };
}

function echoFactory(transformHtml: (key: string, src: string) => string) {
  return (_m: PluginManifest, _dir: string): WorkerLike => {
    const { hostSide, pluginSide } = createFakeWorkerPair();
    pluginSide.addEventListener("message", (ev) => {
      const m = ev.data as Message;
      if (m.type === "host:init") {
        pluginSide.postMessage({
          type: "plugin:ready",
          registered: [
            { kind: "fence", key: "alert" },
            { kind: "fence", key: "note" },
            { kind: "codeblock", key: "demo" },
          ],
        });
      } else if (m.type === "hook:invoke") {
        pluginSide.postMessage({
          type: "hook:result",
          requestId: m.requestId,
          result: { kind: "html", html: transformHtml(m.key, m.payload.source) },
        });
      }
    });
    return hostSide;
  };
}

describe("applyPluginHooks", () => {
  it("replaces a registered fence with the plugin output", async () => {
    const host = new PluginHost({
      workerFactory: echoFactory((key, src) => `<aside data-${key}>${src.trim()}</aside>`),
      handshakeTimeoutMs: 100,
    });
    await host.install({
      manifest: manifest("alerts", { fences: ["alert", "note"] }),
      pluginDir: "/tmp",
      scope: "user",
    });
    const html = "<p>:::note\nbody text\n:::</p>";
    const out = await applyPluginHooks(html, host, { documentPath: null });
    expect(out).toContain("<aside data-note>");
    expect(out).toContain("body text");
    host.disposeAll();
  });

  it("replaces a registered codeblock", async () => {
    const host = new PluginHost({
      workerFactory: echoFactory((_k, s) => `<pre data-plug>${s.trim()}</pre>`),
      handshakeTimeoutMs: 100,
    });
    await host.install({
      manifest: manifest("demos", { codeblocks: ["demo"] }),
      pluginDir: "/tmp",
      scope: "user",
    });
    const html = '<pre><code class="language-demo">hello world</code></pre>';
    const out = await applyPluginHooks(html, host, { documentPath: null });
    expect(out).toContain("<pre data-plug>");
    expect(out).toContain("hello world");
    host.disposeAll();
  });

  it("leaves codeblock untouched when no plugin claims the lang", async () => {
    const host = new PluginHost({
      workerFactory: echoFactory(() => ""),
      handshakeTimeoutMs: 100,
    });
    const html = '<pre><code class="language-unknown">hi</code></pre>';
    const out = await applyPluginHooks(html, host, { documentPath: null });
    expect(out).toBe(html);
    host.disposeAll();
  });

  it("leaves codeblock untouched when lang attribute missing", async () => {
    const host = new PluginHost({
      workerFactory: echoFactory(() => ""),
      handshakeTimeoutMs: 100,
    });
    const html = "<pre><code>raw</code></pre>";
    const out = await applyPluginHooks(html, host, { documentPath: null });
    expect(out).toBe(html);
    host.disposeAll();
  });

  it("leaves fence untouched when no plugin claims the name", async () => {
    const host = new PluginHost({
      workerFactory: echoFactory(() => ""),
      handshakeTimeoutMs: 100,
    });
    const html = "<p>:::nope\nx\n:::</p>";
    const out = await applyPluginHooks(html, host, { documentPath: null });
    expect(out).toBe(html);
    host.disposeAll();
  });

  it("decodes html entities before delegating to the plugin", async () => {
    const captured: string[] = [];
    const host = new PluginHost({
      workerFactory: echoFactory((_k, src) => {
        captured.push(src);
        return `<div>${src}</div>`;
      }),
      handshakeTimeoutMs: 100,
    });
    await host.install({
      manifest: manifest("p", { codeblocks: ["demo"] }),
      pluginDir: "/tmp",
      scope: "user",
    });
    const html =
      '<pre><code class="language-demo">a &amp; b &lt;tag&gt; &quot;q&quot; &#39;s&#39;</code></pre>';
    await applyPluginHooks(html, host, { documentPath: null });
    expect(captured[0]).toBe(`a & b <tag> "q" 's'`);
    host.disposeAll();
  });

  it("returns input unchanged when nothing matches", async () => {
    const host = new PluginHost({
      workerFactory: echoFactory(() => ""),
      handshakeTimeoutMs: 100,
    });
    const html = "<p>just a paragraph</p>";
    const out = await applyPluginHooks(html, host, { documentPath: null });
    expect(out).toBe(html);
    host.disposeAll();
  });

  it("falls back when plugin returns error", async () => {
    const host = new PluginHost({
      workerFactory: (_m, _d) => {
        const { hostSide, pluginSide } = createFakeWorkerPair();
        pluginSide.addEventListener("message", (ev) => {
          const m = ev.data as Message;
          if (m.type === "host:init") {
            pluginSide.postMessage({
              type: "plugin:ready",
              registered: [{ kind: "fence", key: "alert" }],
            });
          } else if (m.type === "hook:invoke") {
            pluginSide.postMessage({
              type: "hook:result",
              requestId: m.requestId,
              result: { kind: "error", message: "broken" },
            });
          }
        });
        return hostSide;
      },
      handshakeTimeoutMs: 100,
    });
    await host.install({
      manifest: manifest("p", { fences: ["alert"] }),
      pluginDir: "/tmp",
      scope: "user",
    });
    const html = "<p>:::alert\nbody\n:::</p>";
    const out = await applyPluginHooks(html, host, { documentPath: null });
    expect(out).toBe(html); // unchanged on error
    host.disposeAll();
  });
});
