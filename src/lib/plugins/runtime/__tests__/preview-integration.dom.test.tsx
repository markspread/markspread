// @vitest-environment jsdom
// S-PL-SEC-001: end-to-end preview integration with a synthetic plugin.
//
// Mounts a tiny component that mirrors the preview pipeline: takes
// markdown, runs the (test) HTML through `applyPluginHooks`, and renders
// via dangerouslySetInnerHTML — the same shape SpreadPane uses in
// production. Asserts that a :::note fence becomes a styled callout.

import { render, waitFor } from "@testing-library/react";
import { useEffect, useState } from "react";
import { describe, expect, it } from "vitest";
import { PluginHost } from "../host";
import { applyPluginHooks } from "../render-hooks";
import { type Message, type WorkerLike, createFakeWorkerPair } from "../sandbox-rpc";

function SyntheticPreview({ initialHtml, host }: { initialHtml: string; host: PluginHost }) {
  const [html, setHtml] = useState("");
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const out = await applyPluginHooks(initialHtml, host, { documentPath: null });
      if (!cancelled) setHtml(out);
    })();
    return () => {
      cancelled = true;
    };
  }, [initialHtml, host]);
  // biome-ignore lint/security/noDangerouslySetInnerHtml: test-only synthetic preview mirrors SpreadPane.
  return <div data-testid="preview" dangerouslySetInnerHTML={{ __html: html }} />;
}

function syntheticAlertsFactory() {
  return (): WorkerLike => {
    const { hostSide, pluginSide } = createFakeWorkerPair();
    pluginSide.addEventListener("message", (ev) => {
      const m = ev.data as Message;
      if (m.type === "host:init") {
        pluginSide.postMessage({
          type: "plugin:ready",
          registered: [
            { kind: "fence", key: "note" },
            { kind: "fence", key: "warning" },
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

describe("preview integration with synthetic plugin", () => {
  it("renders :::note fence as a styled callout", async () => {
    const host = new PluginHost({
      workerFactory: syntheticAlertsFactory(),
      handshakeTimeoutMs: 100,
    });
    await host.install({
      manifest: {
        schemaVersion: 1,
        name: "alerts",
        version: "0.1.0",
        entry: "./index.js",
        permissions: [],
        allowedHosts: [],
        contributes: {
          fences: [
            { name: "note", render: "html" },
            { name: "warning", render: "html" },
          ],
        },
        render: "html",
        engines: { markspread: ">=1.3.0" },
      },
      pluginDir: "/tmp",
      scope: "user",
    });
    const { getByTestId } = render(
      <SyntheticPreview initialHtml="<p>:::note\nimportant body\n:::</p>" host={host} />,
    );
    await waitFor(() => {
      expect(getByTestId("ms-alert-note")).toBeTruthy();
    });
    expect(getByTestId("ms-alert-note").textContent).toContain("important body");
    host.disposeAll();
  });
});
