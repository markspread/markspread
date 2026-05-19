import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ContextMenu, type ContextMenuEntry } from "./ContextMenu";

function items(): ContextMenuEntry[] {
  return [
    { id: "a", label: "Alpha", shortcut: "⌘A", onSelect: vi.fn() },
    { separator: true },
    { id: "b", label: "Bravo", disabled: true, onSelect: vi.fn() },
    { id: "c", label: "Charlie", onSelect: vi.fn() },
  ];
}

afterEach(cleanup);

describe("ContextMenu", () => {
  it("renders a menu with entries", () => {
    render(<ContextMenu x={10} y={10} items={items()} onClose={() => {}} />);
    expect(screen.getByRole("menu")).toBeTruthy();
    expect(screen.getByText("Alpha")).toBeTruthy();
    expect(screen.getByText("⌘A")).toBeTruthy();
  });

  it("activates an item on click and closes", () => {
    const list = items();
    const onClose = vi.fn();
    render(<ContextMenu x={0} y={0} items={list} onClose={onClose} />);
    fireEvent.click(screen.getByText("Charlie"));
    expect(onClose).toHaveBeenCalled();
  });

  it("ignores clicks on disabled items", () => {
    const list = items();
    const onClose = vi.fn();
    render(<ContextMenu x={0} y={0} items={list} onClose={onClose} />);
    fireEvent.click(screen.getByText("Bravo"));
    expect(onClose).not.toHaveBeenCalled();
  });

  it("navigates with arrow keys and activates on Enter", () => {
    const list = items();
    const onClose = vi.fn();
    render(<ContextMenu x={0} y={0} items={list} onClose={onClose} />);
    const menu = screen.getByRole("menu");
    fireEvent.keyDown(menu, { key: "ArrowDown" });
    fireEvent.keyDown(menu, { key: "ArrowUp" });
    fireEvent.keyDown(menu, { key: "Enter" });
    expect(onClose).toHaveBeenCalled();
  });

  it("closes on Escape", () => {
    const onClose = vi.fn();
    render(<ContextMenu x={0} y={0} items={items()} onClose={onClose} />);
    fireEvent.keyDown(screen.getByRole("menu"), { key: "Escape" });
    expect(onClose).toHaveBeenCalled();
  });

  it("closes when clicking outside", () => {
    const onClose = vi.fn();
    render(<ContextMenu x={0} y={0} items={items()} onClose={onClose} />);
    fireEvent.mouseDown(document.body);
    expect(onClose).toHaveBeenCalled();
  });
});
