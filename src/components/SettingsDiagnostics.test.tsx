import { act, cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

const invoke = vi.fn<(cmd: string, args?: unknown) => Promise<unknown>>(
  (cmd: string, _args?: unknown) => {
    if (cmd === "telemetry_access_get") return Promise.resolve({ enabled: true });
    if (cmd === "telemetry_access_query")
      return Promise.resolve([
        { date: "2026-05-01", category: "outside", ruleId: "FAP-001", count: 3 },
      ]);
    return Promise.resolve(undefined);
  },
);
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

  it("re-queries telemetry when the Refresh button is clicked", async () => {
    render(<SettingsDiagnostics />);
    await waitFor(() => expect(screen.getByText("2026-05-01")).toBeTruthy());
    const before = invoke.mock.calls.length;
    await act(async () => {
      screen.getByText("Refresh").click();
    });
    await waitFor(() => {
      expect(invoke.mock.calls.length).toBeGreaterThan(before);
    });
  });

  it("clears recorded denials", async () => {
    render(<SettingsDiagnostics />);
    await waitFor(() => expect(screen.getByText("2026-05-01")).toBeTruthy());
    await act(async () => {
      screen.getByText("Clear").click();
    });
    expect(invoke).toHaveBeenCalledWith("telemetry_access_clear", undefined);
  });

  it("surfaces an alert when refresh fails on mount", async () => {
    invoke.mockImplementationOnce(() => Promise.reject(new Error("boom")));
    render(<SettingsDiagnostics />);
    await waitFor(() => {
      expect(screen.getByRole("alert").textContent).toBe("boom");
    });
  });

  it("stringifies a non-Error rejection from the toggle command", async () => {
    render(<SettingsDiagnostics />);
    await waitFor(() => expect(screen.getByText("2026-05-01")).toBeTruthy());
    invoke.mockImplementationOnce(() => Promise.reject("plain-toggle-error"));
    const checkbox = screen.getByRole("checkbox") as HTMLInputElement;
    await act(async () => {
      checkbox.click();
    });
    await waitFor(() => {
      expect(screen.getByRole("alert").textContent).toBe("plain-toggle-error");
    });
  });

  it("surfaces a typed error from the clear command", async () => {
    render(<SettingsDiagnostics />);
    await waitFor(() => expect(screen.getByText("2026-05-01")).toBeTruthy());
    invoke.mockImplementationOnce(() => Promise.reject(new Error("clear failed")));
    await act(async () => {
      screen.getByText("Clear").click();
    });
    await waitFor(() => {
      expect(screen.getByRole("alert").textContent).toBe("clear failed");
    });
  });

  it("stringifies a non-Error rejection from refresh on mount", async () => {
    invoke.mockImplementationOnce(() => Promise.reject("plain-refresh-error"));
    render(<SettingsDiagnostics />);
    await waitFor(() => {
      expect(screen.getByRole("alert").textContent).toBe("plain-refresh-error");
    });
  });

  it("stringifies a non-Error rejection from the clear command", async () => {
    render(<SettingsDiagnostics />);
    await waitFor(() => expect(screen.getByText("2026-05-01")).toBeTruthy());
    invoke.mockImplementationOnce(() => Promise.reject("plain-clear-error"));
    await act(async () => {
      screen.getByText("Clear").click();
    });
    await waitFor(() => {
      expect(screen.getByRole("alert").textContent).toBe("plain-clear-error");
    });
  });

  it("shows the disabled-recording hint when telemetry is off and the row list is empty", async () => {
    invoke.mockImplementationOnce(() => Promise.resolve({ enabled: false }));
    invoke.mockImplementationOnce(() => Promise.resolve([]));
    render(<SettingsDiagnostics />);
    await waitFor(() => expect(screen.getByText("Recording is disabled.")).toBeTruthy());
  });

  it("shows the empty-data hint when telemetry is on but no denials were recorded", async () => {
    invoke.mockImplementationOnce(() => Promise.resolve({ enabled: true }));
    invoke.mockImplementationOnce(() => Promise.resolve([]));
    render(<SettingsDiagnostics />);
    await waitFor(() => expect(screen.getByText("No denials recorded yet.")).toBeTruthy());
  });
});
