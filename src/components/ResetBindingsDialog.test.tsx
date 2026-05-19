import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

const resetAllToPreset = vi.fn(() => Promise.resolve("/tmp/keybindings.json.bak"));
vi.mock("@/lib/keybindings/persistence", () => ({
  resetAllToPreset: () => resetAllToPreset(),
}));

import { ResetBindingsDialog } from "./ResetBindingsDialog";

afterEach(cleanup);

describe("ResetBindingsDialog", () => {
  it("renders the warning copy", () => {
    render(<ResetBindingsDialog onClose={() => {}} onDone={() => {}} />);
    expect(screen.getByText("Reset all keybindings")).toBeTruthy();
  });

  it("keeps the confirm button disabled until the token is typed", () => {
    render(<ResetBindingsDialog onClose={() => {}} onDone={() => {}} />);
    const confirm = screen.getByText("Reset all") as HTMLButtonElement;
    expect(confirm.disabled).toBe(true);
    fireEvent.change(screen.getByDisplayValue(""), { target: { value: "RESET" } });
    expect(confirm.disabled).toBe(false);
  });

  it("closes on backdrop click", () => {
    const onClose = vi.fn();
    const { container } = render(<ResetBindingsDialog onClose={onClose} onDone={() => {}} />);
    const backdrop = container.querySelector('[role="dialog"]');
    if (backdrop) fireEvent.click(backdrop);
    expect(onClose).toHaveBeenCalled();
  });

  it("performs the reset and surfaces the backup path", async () => {
    vi.useFakeTimers();
    const onClose = vi.fn();
    const onDone = vi.fn();
    render(<ResetBindingsDialog onClose={onClose} onDone={onDone} />);
    fireEvent.change(screen.getByDisplayValue(""), { target: { value: "RESET" } });
    await act(async () => {
      fireEvent.click(screen.getByText("Reset all"));
    });
    expect(resetAllToPreset).toHaveBeenCalled();
    expect(screen.getByText(/keybindings.json.bak/)).toBeTruthy();
    act(() => vi.advanceTimersByTime(1500));
    expect(onDone).toHaveBeenCalled();
    expect(onClose).toHaveBeenCalled();
  });
});
