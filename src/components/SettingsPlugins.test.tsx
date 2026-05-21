import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { PluginManifest } from "../lib/plugins/manifest";

const manifest = {
  id: "acme.tool",
  name: "Acme Tool",
  version: "1.0.0",
} as PluginManifest;

const invoke = vi.fn<(cmd: string, args?: unknown) => Promise<unknown>>(
  (cmd: string, _args?: unknown) => {
    if (cmd === "plugin_list") return Promise.resolve([{ manifest, enabled: true }]);
    return Promise.resolve(undefined);
  },
);
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

  it("refreshes when the marketplace dialog closes", async () => {
    render(<SettingsPlugins />);
    await waitFor(() => expect(screen.getByText("Acme Tool")).toBeTruthy());
    fireEvent.click(screen.getByText("Browse marketplace"));
    const before = invoke.mock.calls.filter((c) => c[0] === "plugin_list").length;
    await act(async () => {
      fireEvent.click(screen.getByLabelText("Close marketplace"));
    });
    const after = invoke.mock.calls.filter((c) => c[0] === "plugin_list").length;
    expect(after).toBeGreaterThan(before);
  });

  it("surfaces an error when plugin_list rejects", async () => {
    invoke.mockImplementationOnce(() => Promise.reject(new Error("list boom")));
    render(<SettingsPlugins />);
    await waitFor(() => expect(screen.getByRole("alert").textContent).toBe("list boom"));
  });

  it("stringifies a non-Error rejection from plugin_enable", async () => {
    render(<SettingsPlugins />);
    await waitFor(() => expect(screen.getByText("Acme Tool")).toBeTruthy());
    invoke.mockImplementationOnce(() => Promise.reject("plain-enable-error"));
    await act(async () => {
      screen.getByRole("checkbox").click();
    });
    await waitFor(() => expect(screen.getByRole("alert").textContent).toBe("plain-enable-error"));
  });

  it("enables a disabled plugin", async () => {
    invoke.mockImplementationOnce(() => Promise.resolve([{ manifest, enabled: false }]));
    render(<SettingsPlugins />);
    await waitFor(() => expect(screen.getByText("Acme Tool")).toBeTruthy());
    await act(async () => {
      screen.getByRole("checkbox").click();
    });
    expect(invoke).toHaveBeenCalledWith("plugin_enable", { pluginId: "acme.tool" });
  });

  it("stringifies a non-Error rejection from plugin_list", async () => {
    invoke.mockImplementationOnce(() => Promise.reject("plain-list-error"));
    render(<SettingsPlugins />);
    await waitFor(() => expect(screen.getByRole("alert").textContent).toBe("plain-list-error"));
  });

  it("stringifies a non-Error rejection from plugin_uninstall", async () => {
    render(<SettingsPlugins />);
    await waitFor(() => expect(screen.getByText("Acme Tool")).toBeTruthy());
    invoke.mockImplementationOnce(() => Promise.reject("plain-uninstall-error"));
    await act(async () => {
      screen.getByText("Uninstall").click();
    });
    await waitFor(() =>
      expect(screen.getByRole("alert").textContent).toBe("plain-uninstall-error"),
    );
  });

  it("surfaces an error when plugin_uninstall rejects", async () => {
    render(<SettingsPlugins />);
    await waitFor(() => expect(screen.getByText("Acme Tool")).toBeTruthy());
    invoke.mockImplementationOnce(() => Promise.reject(new Error("uninstall boom")));
    await act(async () => {
      screen.getByText("Uninstall").click();
    });
    await waitFor(() => expect(screen.getByRole("alert").textContent).toBe("uninstall boom"));
  });
});
