import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const runMock = vi.fn();
vi.mock("@/lib/palette/registry", () => ({
  query: () => [
    {
      id: "cmd.one",
      category: "command",
      label: "First Command",
      description: "Desc one",
      run: runMock,
    },
    {
      id: "cmd.two",
      category: "file",
      label: "Second Command",
      detail: "detail",
      shortcut: "⌘S",
      run: vi.fn(),
    },
  ],
  noteUsed: vi.fn(),
}));

import { closePalette, openPalette } from "@/lib/palette/state";
import { CommandPalette } from "./CommandPalette";

afterEach(cleanup);

describe("CommandPalette", () => {
  beforeEach(() => {
    runMock.mockReset();
    closePalette();
  });
  afterEach(() => closePalette());

  it("renders nothing when closed", () => {
    const { container } = render(<CommandPalette />);
    expect(container.firstChild).toBeNull();
  });

  it("opens and lists items", () => {
    render(<CommandPalette />);
    act(() => openPalette("all"));
    expect(screen.getByRole("dialog")).toBeTruthy();
    expect(screen.getByText("First Command")).toBeTruthy();
    expect(screen.getByText("Second Command")).toBeTruthy();
  });

  it("opens via the ⌘K shortcut", () => {
    render(<CommandPalette />);
    act(() => {
      fireEvent.keyDown(window, { key: "k", metaKey: true });
    });
    expect(screen.getByRole("dialog")).toBeTruthy();
  });

  it("runs the active item on Enter", () => {
    render(<CommandPalette />);
    act(() => openPalette("all"));
    fireEvent.keyDown(screen.getByRole("dialog"), { key: "Enter" });
    expect(runMock).toHaveBeenCalled();
  });

  it("closes on Escape", () => {
    render(<CommandPalette />);
    act(() => openPalette("all"));
    fireEvent.keyDown(screen.getByRole("dialog"), { key: "Escape" });
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("navigates rows with arrow keys", () => {
    render(<CommandPalette />);
    act(() => openPalette("all"));
    const dialog = screen.getByRole("dialog");
    fireEvent.keyDown(dialog, { key: "ArrowDown" });
    fireEvent.keyDown(dialog, { key: "ArrowUp" });
  });

  it("closes when backdrop is mousedowned", () => {
    render(<CommandPalette />);
    act(() => openPalette("all"));
    const dialog = screen.getByRole("dialog");
    fireEvent.mouseDown(dialog, { target: dialog });
    expect(screen.queryByRole("dialog")).toBeNull();
  });
});
