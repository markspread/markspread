// S-PL-SEC-001 (MAR-1019): PluginAuthorPanel — render + button paths.

import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const invoke = vi.fn();
vi.mock("@tauri-apps/api/core", () => ({
  invoke: (...args: unknown[]) => invoke(...(args as Parameters<typeof invoke>)),
}));

import { PluginHost } from "../lib/plugins/runtime/host";
import {
  type Message,
  type WorkerLike,
  createFakeWorkerPair,
} from "../lib/plugins/runtime/sandbox-rpc";
import { scaffoldPlugin } from "../lib/plugins/scaffold";
import { PluginAuthorPanel } from "./PluginAuthorPanel";

afterEach(cleanup);
beforeEach(() => invoke.mockReset());

function makeHost(): PluginHost {
  return new PluginHost({
    workerFactory: () => {
      const { hostSide, pluginSide } = createFakeWorkerPair();
      pluginSide.addEventListener("message", (ev) => {
        const m = ev.data as Message;
        if (m.type === "host:init") {
          pluginSide.postMessage({
            type: "plugin:ready",
            registered: [{ kind: "codeblock", key: "demo" }],
          });
        }
      });
      return hostSide as WorkerLike;
    },
    handshakeTimeoutMs: 100,
  });
}

describe("PluginAuthorPanel", () => {
  it("renders empty state when no draft", () => {
    const host = makeHost();
    render(<PluginAuthorPanel host={host} draft={null} />);
    expect(screen.getByTestId("plugin-author-panel-empty")).toBeTruthy();
    host.disposeAll();
  });

  it("renders draft preview with tabs and switches them", () => {
    const host = makeHost();
    const { files } = scaffoldPlugin({ name: "demo", kind: "codeblock", key: "demo" });
    render(<PluginAuthorPanel host={host} draft={{ name: "demo", files }} />);
    expect(screen.getByTestId("plugin-author-preview").textContent).toContain('"name": "demo"');
    fireEvent.click(screen.getByTestId("plugin-author-tab-index.js"));
    expect(screen.getByTestId("plugin-author-preview").textContent).toContain(
      "self.addEventListener",
    );
    fireEvent.click(screen.getByTestId("plugin-author-tab-README.md"));
    expect(screen.getByTestId("plugin-author-preview").textContent).toContain("# demo");
    host.disposeAll();
  });

  it("shows errors panel for invalid draft manifest", () => {
    const host = makeHost();
    const { files } = scaffoldPlugin({ name: "demo", kind: "codeblock", key: "demo" });
    files["markspread-plugin.json"] = JSON.stringify({
      schemaVersion: 1,
      name: "Bad",
      version: "x",
      entry: "./index.js",
      permissions: [],
      allowedHosts: [],
      contributes: { codeblocks: { demo: { render: "html" } } },
      render: "html",
      engines: { markspread: ">=1.3.0" },
    });
    render(<PluginAuthorPanel host={host} draft={{ name: "demo", files }} />);
    expect(screen.getByTestId("plugin-author-errors")).toBeTruthy();
    host.disposeAll();
  });

  it("shows warnings when manifest is valid but no contributions", () => {
    const host = makeHost();
    const files = {
      "markspread-plugin.json": JSON.stringify({
        schemaVersion: 1,
        name: "noop",
        version: "0.1.0",
        entry: "./index.js",
        permissions: [],
        allowedHosts: [],
        contributes: {},
        render: "html",
        engines: { markspread: ">=1.3.0" },
      }),
      "index.js": "// empty",
      "README.md": "# noop",
    } as const;
    render(<PluginAuthorPanel host={host} draft={{ name: "noop", files }} />);
    expect(screen.getByTestId("plugin-author-warnings")).toBeTruthy();
    host.disposeAll();
  });

  it("Install path: calls invoke + reflects success status", async () => {
    invoke.mockResolvedValue("/tmp/plugins/demo");
    const host = makeHost();
    const { files } = scaffoldPlugin({
      name: "demo",
      kind: "codeblock",
      key: "demo",
      hint: "a demo plugin description",
    });
    render(<PluginAuthorPanel host={host} draft={{ name: "demo", files }} />);
    await act(async () => {
      fireEvent.click(screen.getByTestId("plugin-author-install"));
    });
    expect(screen.getByTestId("plugin-author-ok").textContent).toContain(
      "Installed at /tmp/plugins/demo",
    );
    host.disposeAll();
  });

  it("Install path: surfaces errors when invoke rejects", async () => {
    invoke.mockRejectedValue(new Error("disk full"));
    const host = makeHost();
    const { files } = scaffoldPlugin({
      name: "demo",
      kind: "codeblock",
      key: "demo",
      hint: "a demo plugin description",
    });
    render(<PluginAuthorPanel host={host} draft={{ name: "demo", files }} />);
    await act(async () => {
      fireEvent.click(screen.getByTestId("plugin-author-install"));
    });
    expect(screen.getByTestId("plugin-author-error").textContent).toContain("disk full");
    host.disposeAll();
  });

  it("Reload path: succeeds even when plugin is unknown to host", async () => {
    const host = makeHost();
    const reloadSpy = vi.spyOn(host, "reload");
    const { files } = scaffoldPlugin({
      name: "demo",
      kind: "codeblock",
      key: "demo",
      hint: "demo desc",
    });
    render(<PluginAuthorPanel host={host} draft={{ name: "demo", files }} />);
    await act(async () => {
      fireEvent.click(screen.getByTestId("plugin-author-reload"));
    });
    expect(reloadSpy).toHaveBeenCalledWith("demo");
    expect(screen.getByTestId("plugin-author-ok").textContent).toContain("Reloaded");
    host.disposeAll();
  });

  it("Reload path: surfaces reload errors", async () => {
    const host = makeHost();
    vi.spyOn(host, "reload").mockRejectedValue(new Error("boom"));
    const { files } = scaffoldPlugin({
      name: "demo",
      kind: "codeblock",
      key: "demo",
      hint: "demo desc",
    });
    render(<PluginAuthorPanel host={host} draft={{ name: "demo", files }} />);
    await act(async () => {
      fireEvent.click(screen.getByTestId("plugin-author-reload"));
    });
    expect(screen.getByTestId("plugin-author-error").textContent).toContain("boom");
    host.disposeAll();
  });

  it("Open in Editor: resolves runtime dir and calls callback with full path", async () => {
    invoke.mockResolvedValue("/home/me/.markspread/plugins");
    const onOpen = vi.fn();
    const host = makeHost();
    const { files } = scaffoldPlugin({
      name: "demo",
      kind: "codeblock",
      key: "demo",
      hint: "demo desc",
    });
    render(
      <PluginAuthorPanel host={host} draft={{ name: "demo", files }} onOpenInEditor={onOpen} />,
    );
    await act(async () => {
      fireEvent.click(screen.getByTestId("plugin-author-open"));
    });
    expect(onOpen).toHaveBeenCalledWith("/home/me/.markspread/plugins/demo/index.js");
    host.disposeAll();
  });

  it("Open in Editor: silent path when callback omitted; error path when invoke fails", async () => {
    invoke.mockResolvedValueOnce("/x");
    const host = makeHost();
    const { files } = scaffoldPlugin({
      name: "demo",
      kind: "codeblock",
      key: "demo",
      hint: "demo desc",
    });
    const { rerender } = render(<PluginAuthorPanel host={host} draft={{ name: "demo", files }} />);
    await act(async () => {
      fireEvent.click(screen.getByTestId("plugin-author-open"));
    });
    // no onOpenInEditor → no throw.
    invoke.mockRejectedValueOnce(new Error("nope"));
    rerender(<PluginAuthorPanel host={host} draft={{ name: "demo", files }} />);
    await act(async () => {
      fireEvent.click(screen.getByTestId("plugin-author-open"));
    });
    expect(screen.getByTestId("plugin-author-error").textContent).toContain("nope");
    host.disposeAll();
  });

  it("shows the busy status while install is in flight", async () => {
    let resolve: ((v: string) => void) | undefined;
    invoke.mockImplementation(
      () =>
        new Promise<string>((res) => {
          resolve = res;
        }),
    );
    const host = makeHost();
    const { files } = scaffoldPlugin({
      name: "demo",
      kind: "codeblock",
      key: "demo",
      hint: "demo desc",
    });
    render(<PluginAuthorPanel host={host} draft={{ name: "demo", files }} />);
    fireEvent.click(screen.getByTestId("plugin-author-install"));
    expect(screen.getByTestId("plugin-author-busy").textContent).toContain("Installing");
    await act(async () => {
      resolve?.("/tmp/x");
    });
    host.disposeAll();
  });
});
