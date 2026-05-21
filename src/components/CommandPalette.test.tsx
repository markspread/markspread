import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const runMock = vi.fn();
let mockItems: Array<Record<string, unknown>> = [];
vi.mock("@/lib/palette/registry", () => ({
  query: () => mockItems,
  noteUsed: vi.fn(),
}));

import { closePalette, openPalette } from "@/lib/palette/state";
import { CommandPalette } from "./CommandPalette";

afterEach(cleanup);

const baseItems = (): Array<Record<string, unknown>> => [
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
];

describe("CommandPalette", () => {
  beforeEach(() => {
    runMock.mockReset();
    closePalette();
    mockItems = baseItems();
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

  it("opens in file mode via the ⌘P shortcut", () => {
    render(<CommandPalette />);
    act(() => {
      fireEvent.keyDown(window, { key: "p", metaKey: true });
    });
    expect(screen.getByPlaceholderText("Open file…")).toBeTruthy();
  });

  it("runs an item when its row is mousedowned", () => {
    render(<CommandPalette />);
    act(() => openPalette("all"));
    act(() => {
      fireEvent.mouseDown(screen.getByText("First Command"));
    });
    expect(runMock).toHaveBeenCalled();
  });

  it("renders the empty state when there are no matches", () => {
    mockItems = [];
    render(<CommandPalette />);
    act(() => openPalette("all"));
    expect(screen.getByText("No matches")).toBeTruthy();
  });

  it("swallows errors thrown by an item's run handler", async () => {
    runMock.mockRejectedValueOnce(new Error("item boom"));
    render(<CommandPalette />);
    act(() => openPalette("all"));
    await act(async () => {
      fireEvent.keyDown(screen.getByRole("dialog"), { key: "Enter" });
    });
    expect(runMock).toHaveBeenCalled();
  });

  it("updates the search input as the user types", () => {
    render(<CommandPalette />);
    act(() => openPalette("all"));
    const input = screen.getByRole("dialog").querySelector("input");
    if (!input) throw new Error("input not found");
    fireEvent.change(input, { target: { value: "first" } });
    expect((input as HTMLInputElement).value).toBe("first");
  });

  it("highlights a row on hover", () => {
    render(<CommandPalette />);
    act(() => openPalette("all"));
    const second = screen.getByText("Second Command").closest("li");
    if (!second) throw new Error("row not found");
    fireEvent.mouseEnter(second);
    expect(second.getAttribute("aria-selected")).toBe("true");
  });
});
