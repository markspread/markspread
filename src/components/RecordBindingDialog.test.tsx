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

  it("stringifies non-Error rejections from rebind", async () => {
    if (!firstCommand) throw new Error("registry empty");
    rebind.mockRejectedValueOnce("plain-save-error");
    render(<RecordBindingDialog commandId={firstCommand.id} onClose={() => {}} />);
    act(() => {
      fireEvent.keyDown(window, { key: "j", ctrlKey: true });
    });
    await act(async () => {
      fireEvent.click(screen.getByText("Save"));
    });
    expect(screen.getByText("plain-save-error")).toBeTruthy();
  });

  it("surfaces an error when unbind rejects with an Error", async () => {
    if (!firstCommand) throw new Error("registry empty");
    unbind.mockRejectedValueOnce(new Error("unbind failed"));
    render(<RecordBindingDialog commandId={firstCommand.id} onClose={() => {}} />);
    await act(async () => {
      fireEvent.click(screen.getByText("Unbind"));
    });
    expect(screen.getByText("unbind failed")).toBeTruthy();
  });

  it("stringifies non-Error rejections from resetToPreset", async () => {
    if (!firstCommand) throw new Error("registry empty");
    resetToPreset.mockRejectedValueOnce("plain-reset-error");
    render(<RecordBindingDialog commandId={firstCommand.id} onClose={() => {}} />);
    await act(async () => {
      fireEvent.click(screen.getByText("Reset to preset"));
    });
    expect(screen.getByText("plain-reset-error")).toBeTruthy();
  });

  it("ignores keydowns flagged as IME composition", () => {
    if (!firstCommand) throw new Error("registry empty");
    render(<RecordBindingDialog commandId={firstCommand.id} onClose={() => {}} />);
    act(() => {
      const evt = new KeyboardEvent("keydown", { key: "a", bubbles: true });
      Object.defineProperty(evt, "isComposing", { value: true, configurable: true });
      window.dispatchEvent(evt);
    });
    const save = screen.getByText("Save") as HTMLButtonElement;
    expect(save.disabled).toBe(true);
  });

  it("surfaces a conflict when another command holds the same binding", async () => {
    const { listActiveBindings, normaliseBinding, bindingFromEvent } = await import(
      "@/lib/keybindings"
    );
    const all = listActiveBindings();
    if (!firstCommand) throw new Error("registry empty");
    const other = all.find(
      (e) => e.commandId !== firstCommand.id && /^Mod\+[A-Z]$/.test(normaliseBinding(e.binding)),
    );
    if (!other) throw new Error("no Mod+letter binding available in registry");
    render(<RecordBindingDialog commandId={firstCommand.id} onClose={() => {}} />);
    const letter = normaliseBinding(other.binding).split("+").pop() ?? "A";
    const evt = new KeyboardEvent("keydown", {
      key: letter.toLowerCase(),
      code: `Key${letter}`,
      bubbles: true,
      cancelable: true,
    });
    // jsdom doesn't report a Mac platform, so bindingFromEvent uses ctrlKey
    // as the "Mod" modifier.
    Object.defineProperty(evt, "ctrlKey", { value: true, configurable: true });
    const synthesized = bindingFromEvent(evt);
    expect(normaliseBinding(synthesized)).toBe(normaliseBinding(other.binding));
    act(() => {
      window.dispatchEvent(evt);
    });
    expect(screen.getByText(/Saving will reassign it/)).toBeTruthy();
  });

  it("ignores modifier-only key events", () => {
    if (!firstCommand) throw new Error("registry empty");
    render(<RecordBindingDialog commandId={firstCommand.id} onClose={() => {}} />);
    act(() => {
      fireEvent.keyDown(window, { key: "Meta" });
      fireEvent.keyDown(window, { key: "Control" });
      fireEvent.keyDown(window, { key: "Alt" });
      fireEvent.keyDown(window, { key: "Shift" });
    });
    const save = screen.getByText("Save") as HTMLButtonElement;
    expect(save.disabled).toBe(true);
  });

  it("surfaces an error when rebind rejects", async () => {
    if (!firstCommand) throw new Error("registry empty");
    rebind.mockRejectedValueOnce(new Error("save failed"));
    render(<RecordBindingDialog commandId={firstCommand.id} onClose={() => {}} />);
    act(() => {
      fireEvent.keyDown(window, { key: "j", ctrlKey: true });
    });
    await act(async () => {
      fireEvent.click(screen.getByText("Save"));
    });
    expect(screen.getByText("save failed")).toBeTruthy();
  });

  it("stringifies non-Error rejections from unbind", async () => {
    if (!firstCommand) throw new Error("registry empty");
    unbind.mockRejectedValueOnce("plain-unbind-error");
    render(<RecordBindingDialog commandId={firstCommand.id} onClose={() => {}} />);
    await act(async () => {
      fireEvent.click(screen.getByText("Unbind"));
    });
    expect(screen.getByText("plain-unbind-error")).toBeTruthy();
  });

  it("surfaces an error when resetToPreset rejects", async () => {
    if (!firstCommand) throw new Error("registry empty");
    resetToPreset.mockRejectedValueOnce(new Error("reset failed"));
    render(<RecordBindingDialog commandId={firstCommand.id} onClose={() => {}} />);
    await act(async () => {
      fireEvent.click(screen.getByText("Reset to preset"));
    });
    expect(screen.getByText("reset failed")).toBeTruthy();
  });

  it("closes when the backdrop is clicked", () => {
    if (!firstCommand) throw new Error("registry empty");
    const onClose = vi.fn();
    render(<RecordBindingDialog commandId={firstCommand.id} onClose={onClose} />);
    const dialog = screen.getByRole("dialog");
    fireEvent.click(dialog);
    expect(onClose).toHaveBeenCalled();
  });

  it("does not close when the inner panel is clicked", () => {
    if (!firstCommand) throw new Error("registry empty");
    const onClose = vi.fn();
    render(<RecordBindingDialog commandId={firstCommand.id} onClose={onClose} />);
    const panel = screen.getByRole("dialog").querySelector(".rounded-lg") as HTMLDivElement;
    expect(panel).toBeTruthy();
    fireEvent.click(panel);
    expect(onClose).not.toHaveBeenCalled();
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
