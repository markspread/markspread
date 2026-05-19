import { cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { Icon } from "./Icon";

afterEach(cleanup);

describe("Icon", () => {
  it("renders an svg with default size", () => {
    const { container } = render(<Icon name="settings" />);
    const svg = container.querySelector("svg");
    expect(svg).not.toBeNull();
    expect(svg?.getAttribute("width")).toBe("16");
    expect(svg?.getAttribute("aria-hidden")).toBe("true");
  });

  it("honors a custom size and forwards props", () => {
    const { container } = render(<Icon name="close" size={32} data-testid="x" />);
    const svg = container.querySelector("svg");
    expect(svg?.getAttribute("width")).toBe("32");
    expect(svg?.getAttribute("data-testid")).toBe("x");
  });

  it("renders each icon name without throwing", () => {
    for (const name of [
      "settings",
      "warning",
      "eject",
      "close",
      "star",
      "lock",
      "pin",
      "pin-off",
    ] as const) {
      const { container } = render(<Icon name={name} />);
      expect(container.querySelector("svg")).not.toBeNull();
    }
  });
});
