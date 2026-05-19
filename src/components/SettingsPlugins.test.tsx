import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { PluginManifest } from "../lib/plugins/manifest";

const manifest = {
  id: "acme.tool",
  name: "Acme Tool",
  version: "1.0.0",
} as PluginManifest;

const invoke = vi.fn((cmd: string, _args?: unknown) => {
  if (cmd === "plugin_list") return Promise.resolve([{ manifest, enabled: true }]);
  return Promise.resolve(undefined);
});
vi.mock("@tauri-apps/api/core", () => ({
  invoke: (cmd: string, args?: unknown) => invoke(cmd, args),
}));

import { SettingsPlugins } from "./SettingsPlugins";

afterEach(cleanup);

describe("SettingsPlugins", () => {
  it("lists installed plugins", async () => {
    render(<SettingsPlugins />);
    await waitFor(() => expect(screen.getByText("Acme Tool")).toBeTruthy());
  });

  it("toggles a plugin's enabled state", async () => {
    render(<SettingsPlugins />);
    await waitFor(() => expect(screen.getByText("Acme Tool")).toBeTruthy());
    await act(async () => {
      screen.getByRole("checkbox").click();
    });
    expect(invoke).toHaveBeenCalledWith("plugin_disable", { pluginId: "acme.tool" });
  });

  it("uninstalls a plugin", async () => {
    render(<SettingsPlugins />);
    await waitFor(() => expect(screen.getByText("Acme Tool")).toBeTruthy());
    await act(async () => {
      screen.getByText("Uninstall").click();
    });
    expect(invoke).toHaveBeenCalledWith("plugin_uninstall", { pluginId: "acme.tool" });
  });

  it("opens the marketplace dialog", async () => {
    render(<SettingsPlugins />);
    await waitFor(() => expect(screen.getByText("Acme Tool")).toBeTruthy());
    fireEvent.click(screen.getByText("Browse marketplace"));
    expect(screen.getByText("Plugin Marketplace")).toBeTruthy();
  });
});
