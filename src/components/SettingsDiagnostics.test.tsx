import { act, cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

const invoke = vi.fn((cmd: string, _args?: unknown) => {
  if (cmd === "telemetry_access_get") return Promise.resolve({ enabled: true });
  if (cmd === "telemetry_access_query")
    return Promise.resolve([
      { date: "2026-05-01", category: "outside", ruleId: "FAP-001", count: 3 },
    ]);
  return Promise.resolve(undefined);
});
vi.mock("@tauri-apps/api/core", () => ({
  invoke: (cmd: string, args?: unknown) => invoke(cmd, args),
}));

import { SettingsDiagnostics } from "./SettingsDiagnostics";

afterEach(cleanup);

describe("SettingsDiagnostics", () => {
  it("loads and renders the access-stats table", async () => {
    render(<SettingsDiagnostics />);
    await waitFor(() => expect(screen.getByText("2026-05-01")).toBeTruthy());
    expect(screen.getByText("FAP-001")).toBeTruthy();
    expect(screen.getByText("3")).toBeTruthy();
  });

  it("toggles the opt-in checkbox", async () => {
    render(<SettingsDiagnostics />);
    await waitFor(() => expect(screen.getByText("2026-05-01")).toBeTruthy());
    const checkbox = screen.getByRole("checkbox") as HTMLInputElement;
    await act(async () => {
      checkbox.click();
    });
    expect(invoke).toHaveBeenCalledWith("telemetry_access_set", { enabled: false });
  });

  it("clears recorded denials", async () => {
    render(<SettingsDiagnostics />);
    await waitFor(() => expect(screen.getByText("2026-05-01")).toBeTruthy());
    await act(async () => {
      screen.getByText("Clear").click();
    });
    expect(invoke).toHaveBeenCalledWith("telemetry_access_clear", undefined);
  });
});
