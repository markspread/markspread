import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

const eraseAllData = vi.fn();
vi.mock("@/lib/ops/erase", () => ({
  ERASE_CONFIRMATION_TOKEN: "MARKSPREAD ERASE",
  eraseAllData: (t: string) => eraseAllData(t),
}));

import { EraseAllDialog } from "./EraseAllDialog";

afterEach(cleanup);

describe("EraseAllDialog", () => {
  it("renders a dialog with the confirm input disabled until armed", () => {
    render(<EraseAllDialog onClose={() => {}} onComplete={() => {}} />);
    const submit = screen.getByText("Erase everything");
    expect(submit.getAttribute("aria-disabled")).toBe("true");
  });

  it("arms the submit button once the token is typed", () => {
    render(<EraseAllDialog onClose={() => {}} onComplete={() => {}} />);
    fireEvent.change(screen.getByPlaceholderText("MARKSPREAD ERASE"), {
      target: { value: "MARKSPREAD ERASE" },
    });
    expect(screen.getByText("Erase everything").getAttribute("aria-disabled")).toBe("false");
  });

  it("calls onClose when Cancel is clicked", () => {
    const onClose = vi.fn();
    render(<EraseAllDialog onClose={onClose} onComplete={() => {}} />);
    fireEvent.click(screen.getByText("Cancel"));
    expect(onClose).toHaveBeenCalled();
  });

  it("completes erase on submit", async () => {
    const report = { keychainEntries: 1, removedDirs: ["a"] };
    eraseAllData.mockResolvedValue(report);
    const onComplete = vi.fn();
    render(<EraseAllDialog onClose={() => {}} onComplete={onComplete} />);
    fireEvent.change(screen.getByPlaceholderText("MARKSPREAD ERASE"), {
      target: { value: "MARKSPREAD ERASE" },
    });
    fireEvent.submit(screen.getByText("Erase everything").closest("form") as HTMLFormElement);
    await waitFor(() => expect(onComplete).toHaveBeenCalledWith(report));
  });

  it("surfaces an error when erase fails", async () => {
    eraseAllData.mockRejectedValue(new Error("boom"));
    render(<EraseAllDialog onClose={() => {}} onComplete={() => {}} />);
    fireEvent.change(screen.getByPlaceholderText("MARKSPREAD ERASE"), {
      target: { value: "MARKSPREAD ERASE" },
    });
    fireEvent.submit(screen.getByText("Erase everything").closest("form") as HTMLFormElement);
    await waitFor(() => expect(screen.getByRole("alert").textContent).toBe("boom"));
  });
});
