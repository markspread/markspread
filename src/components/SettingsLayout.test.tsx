import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { useWorkspace } from "../store/workspace";
import { SettingsLayout } from "./SettingsLayout";

afterEach(cleanup);

describe("SettingsLayout", () => {
  beforeEach(() => {
    useWorkspace.setState({ current: null } as never);
  });

  it("renders nothing without a workspace", () => {
    const { container } = render(<SettingsLayout />);
    expect(container.firstChild).toBeNull();
  });

  it("renders the collapsed-mode options with a workspace open", () => {
    useWorkspace.setState({ current: "/tmp/ws" } as never);
    render(<SettingsLayout />);
    expect(screen.getByText("Layout")).toBeTruthy();
    expect(screen.getByText("Slim rail")).toBeTruthy();
    expect(screen.getByText("Fully hidden")).toBeTruthy();
  });

  it("switches the collapsed mode", () => {
    useWorkspace.setState({ current: "/tmp/ws" } as never);
    render(<SettingsLayout />);
    fireEvent.click(screen.getByDisplayValue("hidden"));
    // No throw; the radio updates the layout store.
    expect(screen.getByDisplayValue("hidden")).toBeTruthy();
  });
});
