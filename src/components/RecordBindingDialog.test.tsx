import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

const rebind = vi.fn(() => Promise.resolve());
const unbind = vi.fn(() => Promise.resolve());
const resetToPreset = vi.fn(() => Promise.resolve());
vi.mock("@/lib/keybindings/persistence", () => ({
  rebind: () => rebind(),
  unbind: () => unbind(),
  resetToPreset: () => resetToPreset(),
}));

import { commands } from "@/lib/commands/registry";
import { RecordBindingDialog } from "./RecordBindingDialog";

afterEach(cleanup);

const firstCommand = commands[0];

describe("RecordBindingDialog", () => {
  it("returns null for an unknown command id", () => {
    const { container } = render(
      <RecordBindingDialog commandId="no.such.command" onClose={() => {}} />,
    );
    expect(container.firstChild).toBeNull();
  });

  it("renders the capture prompt for a known command", () => {
    if (!firstCommand) throw new Error("registry empty");
    render(<RecordBindingDialog commandId={firstCommand.id} onClose={() => {}} />);
    expect(screen.getByText("Waiting for keys…")).toBeTruthy();
  });

  it("captures a keypress and enables Save", () => {
    if (!firstCommand) throw new Error("registry empty");
    render(<RecordBindingDialog commandId={firstCommand.id} onClose={() => {}} />);
    act(() => {
      fireEvent.keyDown(window, { key: "k", ctrlKey: true });
    });
    const save = screen.getByText("Save") as HTMLButtonElement;
    expect(save.disabled).toBe(false);
  });

  it("cancels via Escape before capturing", () => {
    if (!firstCommand) throw new Error("registry empty");
    const onClose = vi.fn();
    render(<RecordBindingDialog commandId={firstCommand.id} onClose={onClose} />);
    act(() => {
      fireEvent.keyDown(window, { key: "Escape" });
    });
    expect(onClose).toHaveBeenCalled();
  });

  it("unbinds the command", async () => {
    if (!firstCommand) throw new Error("registry empty");
    const onClose = vi.fn();
    render(<RecordBindingDialog commandId={firstCommand.id} onClose={onClose} />);
    await act(async () => {
      fireEvent.click(screen.getByText("Unbind"));
    });
    expect(unbind).toHaveBeenCalled();
    expect(onClose).toHaveBeenCalled();
  });

  it("resets the command to its preset", async () => {
    if (!firstCommand) throw new Error("registry empty");
    render(<RecordBindingDialog commandId={firstCommand.id} onClose={() => {}} />);
    await act(async () => {
      fireEvent.click(screen.getByText("Reset to preset"));
    });
    expect(resetToPreset).toHaveBeenCalled();
  });

  it("saves the captured binding", async () => {
    if (!firstCommand) throw new Error("registry empty");
    render(<RecordBindingDialog commandId={firstCommand.id} onClose={() => {}} />);
    act(() => {
      fireEvent.keyDown(window, { key: "j", ctrlKey: true });
    });
    await act(async () => {
      fireEvent.click(screen.getByText("Save"));
    });
    expect(rebind).toHaveBeenCalled();
  });
});
