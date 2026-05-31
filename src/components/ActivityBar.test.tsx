import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { useActivityMode } from "../store/activity-mode";
import { ActivityBar } from "./ActivityBar";

describe("ActivityBar", () => {
  beforeEach(() => {
    useActivityMode.setState({ mode: "workspace" });
  });
  afterEach(cleanup);

  it("renders both mode buttons with workspace active by default", () => {
    render(<ActivityBar />);
    expect(screen.getByTestId("activity-workspace").getAttribute("aria-pressed")).toBe("true");
    expect(screen.getByTestId("activity-parser").getAttribute("aria-pressed")).toBe("false");
  });

  it("switches to parser mode on click", () => {
    render(<ActivityBar />);
    fireEvent.click(screen.getByTestId("activity-parser"));
    expect(useActivityMode.getState().mode).toBe("parser");
    expect(screen.getByTestId("activity-parser").getAttribute("aria-pressed")).toBe("true");
    expect(screen.getByTestId("activity-workspace").getAttribute("aria-pressed")).toBe("false");
  });

  it("switches back to workspace mode on click", () => {
    useActivityMode.setState({ mode: "parser" });
    render(<ActivityBar />);
    fireEvent.click(screen.getByTestId("activity-workspace"));
    expect(useActivityMode.getState().mode).toBe("workspace");
  });
});
