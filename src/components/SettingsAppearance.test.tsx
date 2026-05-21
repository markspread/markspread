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
    // Reset persisted store state — earlier tests in the suite share the
    // zustand singleton across `cleanup`s, so leftover writes from
    // sibling specs would otherwise mask a no-op change here.
    useSettings.setState({ editorFontFamily: "" });
    render(<SettingsAppearance />);
    // Wait until the Menlo <option> elements are mounted (one per picker)
    // so fireEvent.change can resolve `target.value` to the option's value.
    await waitFor(() => {
      const opts = screen.getAllByRole("option", { name: "Menlo" });
      expect(opts.length).toBeGreaterThan(0);
    });
    const selects = screen.getAllByRole("combobox") as HTMLSelectElement[];
    const editorSelect = selects[1];
    expect(editorSelect).toBeTruthy();
    expect(editorSelect?.disabled).toBe(false);
    if (editorSelect) fireEvent.change(editorSelect, { target: { value: "Menlo" } });
    await waitFor(() => {
      expect(useSettings.getState().editorFontFamily).toBe("Menlo");
    });
  });

  it("surfaces an alert when os_list_fonts fails", async () => {
    invoke.mockRejectedValueOnce(new Error("listing failed"));
    render(<SettingsAppearance />);
    await waitFor(() => {
      const alerts = screen.getAllByRole("alert");
      expect(alerts.some((a) => a.textContent === "listing failed")).toBe(true);
    });
  });

  it("stringifies a non-Error rejection from os_list_fonts", async () => {
    invoke.mockRejectedValueOnce("plain-string");
    render(<SettingsAppearance />);
    await waitFor(() => {
      const alerts = screen.getAllByRole("alert");
      expect(alerts.some((a) => a.textContent === "plain-string")).toBe(true);
    });
  });

  it("picks a line height", async () => {
    render(<SettingsAppearance />);
    await waitFor(() => expect(screen.getAllByText("Arial").length).toBeGreaterThan(0));
    const radios = screen.getAllByRole("radio") as HTMLInputElement[];
    const lhRadio = radios.find((r) => r.name === "line-height");
    expect(lhRadio).toBeTruthy();
    if (lhRadio) fireEvent.click(lhRadio);
    expect(useSettings.getState().lineHeight).toBeCloseTo(Number(lhRadio?.value ?? 0));
  });

  it("picks a font weight", async () => {
    render(<SettingsAppearance />);
    await waitFor(() => expect(screen.getAllByText("Arial").length).toBeGreaterThan(0));
    const radios = screen.getAllByRole("radio") as HTMLInputElement[];
    const weightRadio = radios.find((r) => r.name === "font-weight");
    expect(weightRadio).toBeTruthy();
    if (weightRadio) fireEvent.click(weightRadio);
    expect(useSettings.getState().fontWeight).toBe(weightRadio?.value);
  });

  it("resets the font size to the default", async () => {
    render(<SettingsAppearance />);
    await waitFor(() => expect(screen.getAllByText("Arial").length).toBeGreaterThan(0));
    useSettings.setState({ fontSizePx: 22 });
    const resetButtons = screen.getAllByText("Reset");
    fireEvent.click(resetButtons[0] as HTMLButtonElement);
    expect(useSettings.getState().fontSizePx).not.toBe(22);
  });

  it("adjusts the letter spacing via the slider and resets it", async () => {
    render(<SettingsAppearance />);
    await waitFor(() => expect(screen.getAllByText("Arial").length).toBeGreaterThan(0));
    const slider = screen.getByLabelText("Letter spacing");
    fireEvent.change(slider, { target: { value: "0.5" } });
    expect(useSettings.getState().letterSpacingPx).toBeCloseTo(0.5);
    const resetButtons = screen.getAllByText("Reset");
    fireEvent.click(resetButtons[1] as HTMLButtonElement);
    expect(useSettings.getState().letterSpacingPx).not.toBeCloseTo(0.5);
  });
});
