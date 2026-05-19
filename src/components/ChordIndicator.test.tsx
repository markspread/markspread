import { act, cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

let chordCb: ((p: string | null) => void) | null = null;
vi.mock("@/lib/keybindings/chord", () => ({
  onChordPrefix: (cb: (p: string | null) => void) => {
    chordCb = cb;
    return () => {
      chordCb = null;
    };
  },
}));
vi.mock("@/lib/keybindings", () => ({
  formatBinding: (b: string) => b,
}));

import { ChordIndicator } from "./ChordIndicator";

afterEach(cleanup);

describe("ChordIndicator", () => {
  it("renders nothing when no chord pending", () => {
    const { container } = render(<ChordIndicator />);
    expect(container.firstChild).toBeNull();
  });

  it("shows the armed prefix when a chord starts", () => {
    render(<ChordIndicator />);
    act(() => chordCb?.("Mod+k"));
    expect(screen.getByText(/Mod\+k/)).toBeTruthy();
    expect(screen.getByText(/waiting for next key/)).toBeTruthy();
  });

  it("hides again when the chord clears", () => {
    const { container } = render(<ChordIndicator />);
    act(() => chordCb?.("Mod+k"));
    act(() => chordCb?.(null));
    expect(container.firstChild).toBeNull();
  });
});
