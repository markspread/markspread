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
