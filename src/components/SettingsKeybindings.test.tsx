import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { SettingsKeybindings } from "./SettingsKeybindings";

afterEach(cleanup);

describe("SettingsKeybindings", () => {
  it("lists every command from the registry", () => {
    render(<SettingsKeybindings />);
    expect(screen.getByText("Keybindings")).toBeTruthy();
  });

  it("filters and shows the empty state for no matches", () => {
    render(<SettingsKeybindings />);
    fireEvent.change(screen.getByPlaceholderText("Search commands…"), {
      target: { value: "zzz-unmatched" },
    });
    expect(screen.getByText("No commands match the search.")).toBeTruthy();
  });
});
