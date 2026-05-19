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
});
