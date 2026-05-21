import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

type Opener = (req: unknown) => void;
let registeredOpener: Opener = () => {};
vi.mock("@/lib/editor/commands/insertTable", () => ({
  setInsertTableOpener: (fn: Opener) => {
    registeredOpener = fn;
  },
}));

import type { InsertTableResult } from "@/lib/editor/commands/insertTable";
import { InsertTableDialog } from "./InsertTableDialog";

function open(): { resolve: ReturnType<typeof vi.fn> } {
  const resolve = vi.fn();
  act(() => registeredOpener({ resolve }));
  return { resolve };
}

afterEach(cleanup);

describe("InsertTableDialog", () => {
  it("renders nothing until opened", () => {
    const { container } = render(<InsertTableDialog />);
    expect(container.firstChild).toBeNull();
  });

  it("opens with default 3x3 inputs", () => {
    render(<InsertTableDialog />);
    open();
    expect(screen.getByRole("dialog")).toBeTruthy();
    const numbers = screen.getAllByRole("spinbutton");
    expect((numbers[0] as HTMLInputElement).value).toBe("3");
  });

  it("submits the table request", () => {
    render(<InsertTableDialog />);
    const { resolve } = open();
    fireEvent.click(screen.getByText("Insert"));
    expect(resolve).toHaveBeenCalledWith(
      expect.objectContaining({ rows: 3, cols: 3 }) as Partial<InsertTableResult>,
    );
  });

  it("cancels with a null result", () => {
    render(<InsertTableDialog />);
    const { resolve } = open();
    fireEvent.click(screen.getByText("Cancel"));
    expect(resolve).toHaveBeenCalledWith(null);
  });

  it("adjusts column alignment count when columns change", () => {
    render(<InsertTableDialog />);
    open();
    const numbers = screen.getAllByRole("spinbutton");
    fireEvent.change(numbers[1] as HTMLInputElement, { target: { value: "5" } });
    expect((numbers[1] as HTMLInputElement).value).toBe("5");
  });

  it("closes on Escape", () => {
    render(<InsertTableDialog />);
    const { resolve } = open();
    fireEvent.keyDown(screen.getByRole("dialog"), { key: "Escape" });
    expect(resolve).toHaveBeenCalledWith(null);
  });

  it("submits via Mod+Enter", () => {
    render(<InsertTableDialog />);
    const { resolve } = open();
    fireEvent.keyDown(screen.getByRole("dialog"), { key: "Enter", metaKey: true });
    expect(resolve).toHaveBeenCalledWith(
      expect.objectContaining({ rows: 3, cols: 3 }) as Partial<InsertTableResult>,
    );
  });

  it("updates a column's alignment when the select changes", () => {
    render(<InsertTableDialog />);
    const { resolve } = open();
    const selects = screen.getAllByRole("combobox") as HTMLSelectElement[];
    const first = selects[0];
    if (first) fireEvent.change(first, { target: { value: "center" } });
    fireEvent.click(screen.getByText("Insert"));
    expect(resolve).toHaveBeenCalledWith(
      expect.objectContaining({
        align: expect.arrayContaining(["center"]),
      }) as Partial<InsertTableResult>,
    );
  });

  it("changes the row count via the rows input", () => {
    render(<InsertTableDialog />);
    const { resolve } = open();
    const numbers = screen.getAllByRole("spinbutton");
    fireEvent.change(numbers[0] as HTMLInputElement, { target: { value: "7" } });
    fireEvent.click(screen.getByText("Insert"));
    expect(resolve).toHaveBeenCalledWith(
      expect.objectContaining({ rows: 7 }) as Partial<InsertTableResult>,
    );
  });

  it("falls back to 1 for NaN row/col input", () => {
    render(<InsertTableDialog />);
    const { resolve } = open();
    const numbers = screen.getAllByRole("spinbutton");
    fireEvent.change(numbers[0] as HTMLInputElement, { target: { value: "abc" } });
    fireEvent.change(numbers[1] as HTMLInputElement, { target: { value: "abc" } });
    fireEvent.click(screen.getByText("Insert"));
    expect(resolve).toHaveBeenCalledWith(
      expect.objectContaining({ rows: 1, cols: 1 }) as Partial<InsertTableResult>,
    );
  });

  it("ignores plain Enter without a modifier", () => {
    render(<InsertTableDialog />);
    const { resolve } = open();
    fireEvent.keyDown(screen.getByRole("dialog"), { key: "Enter" });
    expect(resolve).not.toHaveBeenCalled();
  });

  it("grows the alignment array when columns increase", () => {
    render(<InsertTableDialog />);
    const { resolve } = open();
    const numbers = screen.getAllByRole("spinbutton");
    fireEvent.change(numbers[1] as HTMLInputElement, { target: { value: "5" } });
    fireEvent.click(screen.getByText("Insert"));
    expect(resolve).toHaveBeenCalledWith(
      expect.objectContaining({ cols: 5 }) as Partial<InsertTableResult>,
    );
  });

  it("preserves the alignment array when column count stays the same", () => {
    render(<InsertTableDialog />);
    open();
    const numbers = screen.getAllByRole("spinbutton");
    // Grow to the max (20), then push past it: setColCount clamps back to 20
    // so prev.length === c (20) and the early-return arm fires.
    fireEvent.change(numbers[1] as HTMLInputElement, { target: { value: "20" } });
    fireEvent.change(numbers[1] as HTMLInputElement, { target: { value: "25" } });
    expect(screen.getAllByRole("combobox").length).toBe(20);
  });
});
