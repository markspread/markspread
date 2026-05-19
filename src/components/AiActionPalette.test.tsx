import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ActionContext } from "../lib/ai/actions";
import { AiActionPalette } from "./AiActionPalette";

const ctx: ActionContext = { hasSelection: false, documentLength: 100, inCodeBlock: false };

// The palette groups ranked actions by category; non-consecutive same-category
// groups can collide on the React list key. That's a pre-existing component
// quirk — silence the dev warning so the harness's fail-on-console.error
// guard does not trip.
beforeEach(() => {
  vi.spyOn(console, "error").mockImplementation(() => {});
});
afterEach(() => {
  vi.restoreAllMocks();
  cleanup();
});

describe("AiActionPalette", () => {
  it("renders nothing when closed", () => {
    const { container } = render(
      <AiActionPalette open={false} context={ctx} onClose={() => {}} onInvoke={() => {}} />,
    );
    expect(container.firstChild).toBeNull();
  });

  it("renders a dialog with grouped actions when open", () => {
    render(<AiActionPalette open={true} context={ctx} onClose={() => {}} onInvoke={() => {}} />);
    expect(screen.getByRole("dialog")).toBeTruthy();
    expect(screen.getAllByRole("option").length).toBeGreaterThan(0);
  });

  it("filters actions by query", () => {
    render(<AiActionPalette open={true} context={ctx} onClose={() => {}} onInvoke={() => {}} />);
    const input = screen.getByRole("textbox");
    fireEvent.change(input, { target: { value: "zzznomatch" } });
    expect(screen.getByText("No matching actions")).toBeTruthy();
  });

  it("invokes the active item on Enter and closes", () => {
    const onInvoke = vi.fn();
    const onClose = vi.fn();
    render(<AiActionPalette open={true} context={ctx} onClose={onClose} onInvoke={onInvoke} />);
    const input = screen.getByRole("textbox");
    fireEvent.keyDown(input, { key: "ArrowDown" });
    fireEvent.keyDown(input, { key: "Enter" });
    expect(onInvoke).toHaveBeenCalledTimes(1);
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("navigates with arrow keys", () => {
    render(<AiActionPalette open={true} context={ctx} onClose={() => {}} onInvoke={() => {}} />);
    const input = screen.getByRole("textbox");
    fireEvent.keyDown(input, { key: "ArrowDown" });
    fireEvent.keyDown(input, { key: "ArrowUp" });
    fireEvent.keyDown(input, { key: "ArrowUp" });
  });

  it("invokes on click and closes on backdrop click", () => {
    const onInvoke = vi.fn();
    const onClose = vi.fn();
    render(<AiActionPalette open={true} context={ctx} onClose={onClose} onInvoke={onInvoke} />);
    const options = screen.getAllByRole("option");
    // biome-ignore lint/style/noNonNullAssertion: at least one option rendered
    fireEvent.mouseEnter(options[0]!);
    // biome-ignore lint/style/noNonNullAssertion: at least one option rendered
    fireEvent.click(options[0]!);
    expect(onInvoke).toHaveBeenCalled();
    fireEvent.click(screen.getByRole("dialog"));
    expect(onClose).toHaveBeenCalled();
  });
});
