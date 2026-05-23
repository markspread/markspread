import { act, cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const invokeMock = vi.fn();
vi.mock("@tauri-apps/api/core", () => ({
  invoke: (cmd: string) => invokeMock(cmd),
}));

const checkForUpdate = vi.fn();
const startDownload = vi.fn();
vi.mock("../lib/updater/updater", () => ({
  checkForUpdate: (channel: string) => checkForUpdate(channel),
  startDownload: (m: unknown) => startDownload(m),
}));

import { useUpdater } from "../store/updater";
import { AutoUpdateConsent } from "./AutoUpdateConsent";

afterEach(cleanup);

describe("AutoUpdateConsent", () => {
  beforeEach(() => {
    invokeMock.mockReset();
    (window as { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__ = {};
    useUpdater.setState({ consent: "unset", firstRunPromptShown: false });
  });
  afterEach(() => {
    // biome-ignore lint/performance/noDelete: test cleanup of injected global.
    delete (window as { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__;
    useUpdater.setState({ consent: "unset", firstRunPromptShown: false });
  });

  it("renders nothing outside the tauri runtime", () => {
    // biome-ignore lint/performance/noDelete: test cleanup of injected global.
    delete (window as { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__;
    invokeMock.mockResolvedValue(false);
    const { container } = render(<AutoUpdateConsent />);
    expect(container.firstChild).toBeNull();
  });

  it("renders nothing while portable status is unknown", () => {
    invokeMock.mockReturnValue(new Promise(() => {}));
    const { container } = render(<AutoUpdateConsent />);
    expect(container.firstChild).toBeNull();
  });

  it("shows the consent dialog for a non-portable install", async () => {
    invokeMock.mockResolvedValue(false);
    render(<AutoUpdateConsent />);
    await waitFor(() => expect(screen.getByRole("dialog")).toBeTruthy());
    expect(screen.getByText("Enable automatic updates?")).toBeTruthy();
  });

  it("records deny when Decline is clicked", async () => {
    invokeMock.mockResolvedValue(false);
    render(<AutoUpdateConsent />);
    await waitFor(() => expect(screen.getByRole("dialog")).toBeTruthy());
    screen.getByText("Decline").click();
    await waitFor(() => expect(useUpdater.getState().consent).toBe("deny"));
  });

  it("renders nothing once consent already set", () => {
    invokeMock.mockResolvedValue(false);
    useUpdater.setState({ consent: "allow", firstRunPromptShown: true });
    const { container } = render(<AutoUpdateConsent />);
    expect(container.firstChild).toBeNull();
  });

  it("denies when Escape is pressed inside the focus trap", async () => {
    invokeMock.mockResolvedValue(false);
    render(<AutoUpdateConsent />);
    await waitFor(() => expect(screen.getByRole("dialog")).toBeTruthy());
    const evt = new KeyboardEvent("keydown", { key: "Escape", bubbles: true });
    document.dispatchEvent(evt);
    await waitFor(() => expect(useUpdater.getState().consent).toBe("deny"));
  });

  it("treats a portable install as an implicit deny", async () => {
    invokeMock.mockResolvedValue(true);
    const { container } = render(<AutoUpdateConsent />);
    await waitFor(() => expect(useUpdater.getState().consent).toBe("deny"));
    expect(container.firstChild).toBeNull();
  });

  it("falls back to non-portable when portable_is_active rejects", async () => {
    invokeMock.mockRejectedValue(new Error("boom"));
    render(<AutoUpdateConsent />);
    await waitFor(() => expect(screen.getByRole("dialog")).toBeTruthy());
  });

  it("starts a download immediately when Allow is clicked", async () => {
    invokeMock.mockResolvedValue(false);
    checkForUpdate.mockResolvedValue({ version: "9.9.9" });
    startDownload.mockResolvedValue(undefined);
    render(<AutoUpdateConsent />);
    await waitFor(() => expect(screen.getByRole("dialog")).toBeTruthy());
    await act(async () => {
      screen.getByText("Allow").click();
    });
    await waitFor(() => expect(useUpdater.getState().consent).toBe("allow"));
    await waitFor(() => expect(checkForUpdate).toHaveBeenCalledWith("stable"));
    await waitFor(() => expect(startDownload).toHaveBeenCalledWith({ version: "9.9.9" }));
  });

  it("skips startDownload when checkForUpdate returns no manifest", async () => {
    invokeMock.mockResolvedValue(false);
    checkForUpdate.mockResolvedValue(null);
    startDownload.mockClear();
    render(<AutoUpdateConsent />);
    await waitFor(() => expect(screen.getByRole("dialog")).toBeTruthy());
    await act(async () => {
      screen.getByText("Allow").click();
    });
    await waitFor(() => expect(checkForUpdate).toHaveBeenCalled());
    expect(startDownload).not.toHaveBeenCalled();
  });

  it("logs when the immediate update check rejects", async () => {
    invokeMock.mockResolvedValue(false);
    checkForUpdate.mockRejectedValue(new Error("net down"));
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    render(<AutoUpdateConsent />);
    await waitFor(() => expect(screen.getByRole("dialog")).toBeTruthy());
    await act(async () => {
      screen.getByText("Allow").click();
    });
    await waitFor(() => expect(warn).toHaveBeenCalled());
    warn.mockRestore();
  });
});
