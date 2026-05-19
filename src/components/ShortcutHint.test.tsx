import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useOnboarding } from "../store/onboarding";
import { ShortcutHint } from "./ShortcutHint";

afterEach(cleanup);

describe("ShortcutHint", () => {
  beforeEach(() => {
    useOnboarding.setState({
      welcomeBannerDismissed: true,
      tourCompleted: true,
      tourStep: null,
      shortcutHintDismissed: false,
    });
  });

  it("stays hidden until the idle delay elapses", () => {
    vi.useFakeTimers();
    const { container } = render(<ShortcutHint />);
    expect(container.firstChild).toBeNull();
    act(() => vi.advanceTimersByTime(30_000));
    expect(screen.getByText("Press to open the command palette")).toBeTruthy();
  });

  it("does not show when already dismissed", () => {
    useOnboarding.setState({ shortcutHintDismissed: true });
    const { container } = render(<ShortcutHint />);
    expect(container.firstChild).toBeNull();
  });

  it("dismisses via the Got it button", () => {
    vi.useFakeTimers();
    render(<ShortcutHint />);
    act(() => vi.advanceTimersByTime(30_000));
    fireEvent.click(screen.getByText("Got it"));
    expect(useOnboarding.getState().shortcutHintDismissed).toBe(true);
  });

  it("stays hidden while the welcome banner is active", () => {
    useOnboarding.setState({ welcomeBannerDismissed: false, tourCompleted: false });
    const { container } = render(<ShortcutHint />);
    expect(container.firstChild).toBeNull();
  });
});
