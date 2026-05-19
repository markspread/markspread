import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const invoke = vi.fn((..._args: unknown[]) => Promise.resolve("1.2.3"));
vi.mock("@tauri-apps/api/core", () => ({
  invoke: (...args: unknown[]) => invoke(...args),
}));

const checkForUpdate = vi.fn(() => Promise.resolve(null));
vi.mock("../lib/updater/updater", () => ({
  checkForUpdate: () => checkForUpdate(),
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
});
