import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@tauri-apps/api/core", () => ({
  invoke: () => Promise.resolve([]),
}));
vi.mock("../lib/ai/subscription-auth", () => ({
  createSubscriptionAuthFlow: () => ({
    start: () => Promise.resolve({ kind: "idle" }),
    cancel: () => Promise.resolve(),
    getStage: () => ({ kind: "idle" }),
  }),
}));
vi.mock("../lib/ai/subscription-auth-tauri", () => ({
  createTauriAuthTransport: () => ({}),
}));
vi.mock("../lib/backup/backup", () => ({
  listSnapshots: () => Promise.resolve([]),
  restoreSnapshot: () => Promise.resolve(),
}));
vi.mock("../lib/updater/updater", () => ({
  checkForUpdate: () => Promise.resolve(null),
}));

import { useSettingsSheet } from "../store/settings-sheet";
import { useTheme } from "../store/theme";
import { useWorkspace } from "../store/workspace";
import { SettingsSheet } from "./SettingsSheet";

afterEach(cleanup);

describe("SettingsSheet", () => {
  beforeEach(() => {
    useSettingsSheet.setState({ open: false });
    useWorkspace.setState({ current: null } as never);
    useTheme.setState({ mode: "system" } as never);
  });

  it("renders nothing while closed", () => {
    const { container } = render(<SettingsSheet />);
    expect(container.firstChild).toBeNull();
  });

  it("renders the settings panels when open", () => {
    useSettingsSheet.setState({ open: true });
    render(<SettingsSheet />);
    expect(screen.getByText("Settings")).toBeTruthy();
    expect(screen.getAllByText("Theme").length).toBeGreaterThan(0);
    expect(screen.getByText("Appearance")).toBeTruthy();
  });

  it("switches the theme mode", () => {
    useSettingsSheet.setState({ open: true });
    render(<SettingsSheet />);
    fireEvent.click(screen.getByDisplayValue("dark"));
    expect(useTheme.getState().mode).toBe("dark");
  });

  it("closes via the close button", () => {
    useSettingsSheet.setState({ open: true });
    render(<SettingsSheet />);
    fireEvent.click(screen.getByLabelText("Close settings"));
    expect(useSettingsSheet.getState().open).toBe(false);
  });

  it("closes on Escape", () => {
    useSettingsSheet.setState({ open: true });
    render(<SettingsSheet />);
    fireEvent.keyDown(window, { key: "Escape" });
    expect(useSettingsSheet.getState().open).toBe(false);
  });
});
