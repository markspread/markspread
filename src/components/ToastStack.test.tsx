import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useToasts } from "../store/toasts";
import { ToastStack } from "./ToastStack";

afterEach(cleanup);

describe("ToastStack", () => {
  beforeEach(() => {
    useToasts.setState({ toasts: [] });
  });

  it("renders nothing when there are no toasts", () => {
    const { container } = render(<ToastStack />);
    expect(container.firstChild).toBeNull();
  });

  it("renders info and error toasts with proper roles", () => {
    useToasts.setState({
      toasts: [
        { id: "a", kind: "info", message: "hello" },
        { id: "b", kind: "error", message: "boom", details: "stack" },
      ],
    });
    render(<ToastStack />);
    expect(screen.getByText("hello")).toBeTruthy();
    expect(screen.getByText("stack")).toBeTruthy();
    expect(screen.getByRole("alert")).toBeTruthy();
    expect(screen.getByRole("status")).toBeTruthy();
  });

  it("dismisses a toast", () => {
    useToasts.setState({ toasts: [{ id: "a", kind: "info", message: "hello" }] });
    render(<ToastStack />);
    fireEvent.click(screen.getByLabelText("Dismiss notification"));
    expect(useToasts.getState().toasts).toHaveLength(0);
  });

  it("runs the action and dismisses", () => {
    const onClick = vi.fn();
    useToasts.setState({
      toasts: [{ id: "a", kind: "success", message: "done", action: { label: "Undo", onClick } }],
    });
    render(<ToastStack />);
    fireEvent.click(screen.getByText("Undo"));
    expect(onClick).toHaveBeenCalled();
    expect(useToasts.getState().toasts).toHaveLength(0);
  });
});
