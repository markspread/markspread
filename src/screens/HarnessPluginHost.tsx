// S-PL-SEC-001: e2e harness — boots a real PluginHost in the renderer
// with an in-memory fake worker that mimics the github-alerts sample.
// Asserts that `:::note` fence text renders as the plugin-emitted aside.

import { useEffect, useState } from "react";
import { PluginHost } from "../lib/plugins/runtime/host";
import { applyPluginHooks } from "../lib/plugins/runtime/render-hooks";
import {
  type Message,
  type WorkerLike,
  createFakeWorkerPair,
} from "../lib/plugins/runtime/sandbox-rpc";

const SEED_HTML =
  "<h1>Plugin Host Harness</h1>" +
  "<p>:::note\nGitHub-style note body.\n:::</p>" +
  "<p>:::warning\nGitHub-style warning body.\n:::</p>" +
  "<p>Plain paragraph stays untouched.</p>";

function alertsFactory(): () => WorkerLike {
  return () => {
    const { hostSide, pluginSide } = createFakeWorkerPair();
    pluginSide.addEventListener("message", (ev) => {
      const m = ev.data as Message;
      if (m.type === "host:init") {
        pluginSide.postMessage({
          type: "plugin:ready",
          registered: [
            { kind: "fence", key: "note" },
            { kind: "fence", key: "warning" },
            { kind: "fence", key: "tip" },
          ],
        });
      } else if (m.type === "hook:invoke") {
        pluginSide.postMessage({
          type: "hook:result",
          requestId: m.requestId,
          result: {
            kind: "html",
            html: `<aside class="ms-alert ms-alert-${m.key}" data-testid="ms-alert-${m.key}">${m.payload.source.trim()}</aside>`,
          },
        });
      }
    });
    return hostSide;
  };
}

export function HarnessPluginHost() {
  const [html, setHtml] = useState("");
  const [status, setStatus] = useState<"loading" | "ready" | "error">("loading");
  useEffect(() => {
    let cancelled = false;
    const host = new PluginHost({
      workerFactory: alertsFactory(),
      handshakeTimeoutMs: 1_000,
    });
    (async () => {
      try {
        await host.install({
          manifest: {
            schemaVersion: 1,
            name: "github-alerts",
            version: "0.1.0",
            entry: "./index.js",
            permissions: [],
            allowedHosts: [],
            contributes: {
              fences: [
                { name: "note", render: "html" },
                { name: "warning", render: "html" },
                { name: "tip", render: "html" },
              ],
            },
            render: "html",
            engines: { markspread: ">=1.3.0" },
          },
          pluginDir: "/virtual/github-alerts",
          scope: "user",
        });
        const out = await applyPluginHooks(SEED_HTML, host, { documentPath: null });
        if (!cancelled) {
          setHtml(out);
          setStatus("ready");
        }
      } catch {
        if (!cancelled) setStatus("error");
      }
    })();
    return () => {
      cancelled = true;
      host.disposeAll();
    };
  }, []);
  return (
    <div data-testid="plugin-host-harness" data-plugin-host-status={status}>
      {/* biome-ignore lint/security/noDangerouslySetInnerHtml: harness mirrors SpreadPane preview injection. */}
      <div data-testid="plugin-host-preview" dangerouslySetInnerHTML={{ __html: html }} />
    </div>
  );
}
