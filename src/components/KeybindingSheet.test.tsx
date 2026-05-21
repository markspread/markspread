import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/keybindings/layout", () => ({
  loadLayoutMap: () => Promise.resolve(),
  onLayoutChange: () => () => {},
  codeFromKeySegment: (s: string) => s,
  labelForCode: (s: string) => s,
}));

import { KeybindingSheet } from "./KeybindingSheet";

afterEach(cleanup);

describe("KeybindingSheet", () => {
  it("renders the shortcuts list grouped by category", () => {
    render(<KeybindingSheet onClose={() => {}} onEditBinding={() => {}} />);
    expect(screen.getByText("Keyboard Shortcuts")).toBeTruthy();
    expect(screen.getAllByText("Edit").length).toBeGreaterThan(0);
  });

  it("filters the list via the search box", () => {
    render(<KeybindingSheet onClose={() => {}} onEditBinding={() => {}} />);
    const search = screen.getByLabelText("Search shortcuts");
    fireEvent.change(search, { target: { value: "zzz-no-such-command" } });
    expect(screen.getByText("No shortcuts match your search.")).toBeTruthy();
  });

  it("closes via the close button", () => {
    const onClose = vi.fn();
    render(<KeybindingSheet onClose={onClose} onEditBinding={() => {}} />);
    fireEvent.click(screen.getByLabelText("Close"));
    expect(onClose).toHaveBeenCalled();
  });

  it("closes on Escape", () => {
    const onClose = vi.fn();
    render(<KeybindingSheet onClose={onClose} onEditBinding={() => {}} />);
    fireEvent.keyDown(window, { key: "Escape" });
    expect(onClose).toHaveBeenCalled();
  });

  it("highlights matching characters in filtered results", () => {
    const { container } = render(<KeybindingSheet onClose={() => {}} onEditBinding={() => {}} />);
    const search = screen.getByLabelText("Search shortcuts");
    fireEvent.change(search, { target: { value: "e" } });
    expect(container.querySelector("mark")).toBeTruthy();
  });

  it("invokes onEditBinding for a row", () => {
    const onEditBinding = vi.fn();
    render(<KeybindingSheet onClose={() => {}} onEditBinding={onEditBinding} />);
    const editButtons = screen.getAllByText("Edit");
    const first = editButtons[0];
    if (first) fireEvent.click(first);
    expect(onEditBinding).toHaveBeenCalled();
  });
});
