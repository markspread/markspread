import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const invoke = vi.fn((..._args: unknown[]) => Promise.resolve("1.2.3"));
vi.mock("@tauri-apps/api/core", () => ({
  invoke: (...args: unknown[]) => invoke(...args),
}));

const checkForUpdate = vi.fn<typeof import("../lib/updater/updater").checkForUpdate>(() =>
  Promise.resolve(null),
);
vi.mock("../lib/updater/updater", () => ({
  checkForUpdate: (channel: "stable" | "beta" | "alpha") => checkForUpdate(channel),
}));

import { useUpdater } from "../store/updater";
import { SettingsUpdater } from "./SettingsUpdater";

afterEach(cleanup);

describe("SettingsUpdater", () => {
  beforeEach(() => {
    useUpdater.setState({ consent: "deny", firstRunPromptShown: true });
  });

  it("renders the current version once loaded", async () => {
    render(<SettingsUpdater />);
    await waitFor(() => expect(screen.getByText("1.2.3")).toBeTruthy());
  });

  it("toggles auto-download consent", async () => {
    render(<SettingsUpdater />);
    await waitFor(() => expect(screen.getByText("1.2.3")).toBeTruthy());
    fireEvent.click(screen.getByRole("checkbox"));
    expect(useUpdater.getState().consent).toBe("allow");
  });

  it("runs a manual update check and reports up-to-date", async () => {
    render(<SettingsUpdater />);
    await waitFor(() => expect(screen.getByText("1.2.3")).toBeTruthy());
    await act(async () => {
      fireEvent.click(screen.getByText("Check for updates"));
    });
    expect(checkForUpdate).toHaveBeenCalled();
    expect(screen.getByText("You're on the latest version.")).toBeTruthy();
  });

  it("switches the release channel", async () => {
    render(<SettingsUpdater />);
    await waitFor(() => expect(screen.getByText("1.2.3")).toBeTruthy());
    fireEvent.change(screen.getByRole("combobox"), { target: { value: "beta" } });
    expect((screen.getByRole("combobox") as HTMLSelectElement).value).toBe("beta");
  });

  it("reports the available version when checkForUpdate returns a manifest", async () => {
    checkForUpdate.mockResolvedValueOnce({
      version: "9.9.9",
      notesMarkdown: "",
      pubDate: "2026-01-01T00:00:00Z",
      platforms: {},
      signature: "",
    });
    render(<SettingsUpdater />);
    await waitFor(() => expect(screen.getByText("1.2.3")).toBeTruthy());
    await act(async () => {
      fireEvent.click(screen.getByText("Check for updates"));
    });
    expect(screen.getByText(/Update available/)).toBeTruthy();
  });

  it("surfaces a typed error message when the check fails", async () => {
    checkForUpdate.mockRejectedValueOnce(new Error("network down"));
    render(<SettingsUpdater />);
    await waitFor(() => expect(screen.getByText("1.2.3")).toBeTruthy());
    await act(async () => {
      fireEvent.click(screen.getByText("Check for updates"));
    });
    await waitFor(() => expect(screen.getByText("network down")).toBeTruthy());
  });

  it("stringifies a non-Error rejection from the updater", async () => {
    checkForUpdate.mockRejectedValueOnce("plain-string-error");
    render(<SettingsUpdater />);
    await waitFor(() => expect(screen.getByText("1.2.3")).toBeTruthy());
    await act(async () => {
      fireEvent.click(screen.getByText("Check for updates"));
    });
    await waitFor(() => expect(screen.getByText("plain-string-error")).toBeTruthy());
  });

  it("reflects an initial consent of 'allow' in the checkbox", () => {
    useUpdater.setState({ consent: "allow", firstRunPromptShown: true });
    render(<SettingsUpdater />);
    expect((screen.getByRole("checkbox") as HTMLInputElement).checked).toBe(true);
  });

  it("flips consent back to deny when the checkbox is unchecked", async () => {
    useUpdater.setState({ consent: "allow", firstRunPromptShown: true });
    render(<SettingsUpdater />);
    await waitFor(() => expect(screen.getByText("1.2.3")).toBeTruthy());
    fireEvent.click(screen.getByRole("checkbox"));
    expect(useUpdater.getState().consent).toBe("deny");
  });
});
