import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

const invoke = vi.fn((..._args: unknown[]) => Promise.resolve(undefined));
vi.mock("@tauri-apps/api/core", () => ({
  invoke: (...args: unknown[]) => invoke(...args),
}));

import { SettingsSecurity } from "./SettingsSecurity";

afterEach(cleanup);

describe("SettingsSecurity", () => {
  it("renders the erase entry point", () => {
    render(<SettingsSecurity />);
    expect(screen.getByText("Erase all data…")).toBeTruthy();
  });

  it("reveals a confirmation gate before erasing", () => {
    render(<SettingsSecurity />);
    fireEvent.click(screen.getByText("Erase all data…"));
    expect(screen.getByText("Yes, erase everything")).toBeTruthy();
    fireEvent.click(screen.getByText("Cancel"));
    expect(screen.getByText("Erase all data…")).toBeTruthy();
  });

  it("calls the erase command on confirmation", async () => {
    const reload = vi.fn();
    Object.defineProperty(window, "location", {
      configurable: true,
      value: { ...window.location, reload },
    });
    render(<SettingsSecurity />);
    fireEvent.click(screen.getByText("Erase all data…"));
    await act(async () => {
      fireEvent.click(screen.getByText("Yes, erase everything"));
    });
    expect(invoke).toHaveBeenCalledWith("security_erase_all_data");
  });
});
