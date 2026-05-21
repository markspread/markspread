import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { PluginPermission } from "../lib/plugins/manifest";

const invoke = vi.fn((..._args: unknown[]) => Promise.resolve(undefined));
vi.mock("@tauri-apps/api/core", () => ({
  invoke: (...args: unknown[]) => invoke(...args),
}));

import { PluginPermissionDialog } from "./PluginPermissionDialog";

afterEach(cleanup);

const perms: PluginPermission[] = [
  "fs.workspace-read",
  "fs.workspace-write",
  { network: ["api.example.com"] },
];

describe("PluginPermissionDialog", () => {
  it("renders all requested permissions checked by default", () => {
    render(
      <PluginPermissionDialog
        pluginId="acme.plugin"
        pluginName="Acme"
        requestedPermissions={perms}
        onAllow={() => {}}
        onDeny={() => {}}
      />,
    );
    expect(screen.getByText(/requests permissions/)).toBeTruthy();
    const boxes = screen.getAllByRole("checkbox") as HTMLInputElement[];
    expect(boxes.every((b) => b.checked)).toBe(true);
  });

  it("denies via the Deny button", () => {
    const onDeny = vi.fn();
    render(
      <PluginPermissionDialog
        pluginId="acme.plugin"
        pluginName="Acme"
        requestedPermissions={perms}
        onAllow={() => {}}
        onDeny={onDeny}
      />,
    );
    fireEvent.click(screen.getByText("Deny"));
    expect(onDeny).toHaveBeenCalled();
  });

  it("describes every permission shape", () => {
    const allPerms: PluginPermission[] = [
      "fs.workspace-read",
      "fs.workspace-write",
      "fs.outside",
      "shell",
      { network: ["api.example.com"] },
      { keychain: ["claude.token"] },
    ];
    render(
      <PluginPermissionDialog
        pluginId="acme.plugin"
        pluginName="Acme"
        requestedPermissions={allPerms}
        onAllow={() => {}}
        onDeny={() => {}}
      />,
    );
    expect(screen.getByText("Read files in this workspace")).toBeTruthy();
    expect(screen.getByText("Write files in this workspace")).toBeTruthy();
    expect(screen.getByText("Read/write files outside this workspace")).toBeTruthy();
    expect(screen.getByText("Run shell commands (denied in v1)")).toBeTruthy();
    expect(screen.getByText(/Network:.*api\.example\.com/)).toBeTruthy();
    expect(screen.getByText(/Keychain:.*claude\.token/)).toBeTruthy();
  });

  it("toggles a permission off then back on", () => {
    render(
      <PluginPermissionDialog
        pluginId="acme.plugin"
        pluginName="Acme"
        requestedPermissions={perms}
        onAllow={() => {}}
        onDeny={() => {}}
      />,
    );
    const boxes = screen.getAllByRole("checkbox") as HTMLInputElement[];
    const first = boxes[0];
    if (!first) throw new Error("checkbox missing");
    fireEvent.click(first);
    expect(first.checked).toBe(false);
    fireEvent.click(first);
    expect(first.checked).toBe(true);
  });

  it("closes the dialog even when invoke rejects", async () => {
    invoke.mockRejectedValueOnce(new Error("backend refused"));
    const onAllow = vi.fn();
    render(
      <PluginPermissionDialog
        pluginId="acme.plugin"
        pluginName="Acme"
        requestedPermissions={perms}
        onAllow={onAllow}
        onDeny={() => {}}
      />,
    );
    await act(async () => {
      fireEvent.click(screen.getByText("Allow"));
    });
    expect(onAllow).toHaveBeenCalled();
  });

  it("allows only the still-selected permissions", async () => {
    const onAllow = vi.fn();
    render(
      <PluginPermissionDialog
        pluginId="acme.plugin"
        pluginName="Acme"
        requestedPermissions={perms}
        onAllow={onAllow}
        onDeny={() => {}}
      />,
    );
    const boxes = screen.getAllByRole("checkbox") as HTMLInputElement[];
    const first = boxes[0];
    if (first) fireEvent.click(first);
    await act(async () => {
      fireEvent.click(screen.getByText("Allow"));
    });
    expect(invoke).toHaveBeenCalledWith("plugin_permission_prompt", {
      pluginId: "acme.plugin",
      granted: ["fs.workspace-write", { network: ["api.example.com"] }],
    });
    expect(onAllow).toHaveBeenCalled();
  });
});
