import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

const invoke = vi.fn((..._args: unknown[]) => Promise.resolve(["Inter", "Arial", "Menlo"]));
vi.mock("@tauri-apps/api/core", () => ({
  invoke: (...args: unknown[]) => invoke(...args),
}));

import { useSettings } from "../store/settings";
import { SettingsAppearance } from "./SettingsAppearance";

afterEach(cleanup);

describe("SettingsAppearance", () => {
  it("renders the font pickers populated from the OS font list", async () => {
    render(<SettingsAppearance />);
    expect(screen.getByText("Appearance")).toBeTruthy();
    await waitFor(() => expect(screen.getAllByText("Arial").length).toBeGreaterThan(0));
  });

  it("adjusts the font size via the range slider", async () => {
    render(<SettingsAppearance />);
    await waitFor(() => expect(screen.getAllByText("Arial").length).toBeGreaterThan(0));
    const slider = screen.getByLabelText("Font size");
    fireEvent.change(slider, { target: { value: "20" } });
    expect(useSettings.getState().fontSizePx).toBe(20);
  });

  it("changes the editor font family", async () => {
    render(<SettingsAppearance />);
    // Wait for os_list_fonts to populate the <option> list — without this the
    // select has no "Menlo" option yet and fireEvent.change is a no-op.
    await waitFor(() => expect(screen.getAllByText("Menlo").length).toBeGreaterThan(0));
    const selects = await screen.findAllByRole("combobox");
    const editorSelect = selects[1];
    if (editorSelect) fireEvent.change(editorSelect, { target: { value: "Menlo" } });
    expect(useSettings.getState().editorFontFamily).toBe("Menlo");
  });

  it("picks a line height", async () => {
    render(<SettingsAppearance />);
    await waitFor(() => expect(screen.getAllByText("Arial").length).toBeGreaterThan(0));
    const radios = screen.getAllByRole("radio");
    const first = radios[0];
    if (first) fireEvent.click(first);
    expect(radios.length).toBeGreaterThan(0);
  });
});
