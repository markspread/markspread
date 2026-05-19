import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useOnboarding } from "../store/onboarding";
import { WelcomeBanner } from "./WelcomeBanner";

afterEach(cleanup);

describe("WelcomeBanner", () => {
  beforeEach(() => {
    useOnboarding.setState({
      welcomeBannerDismissed: false,
      tourCompleted: false,
      tourStep: null,
    });
  });

  it("renders the welcome content", () => {
    render(<WelcomeBanner />);
    expect(screen.getByText("Welcome to Markspread")).toBeTruthy();
  });

  it("returns null once dismissed", () => {
    useOnboarding.setState({ welcomeBannerDismissed: true });
    const { container } = render(<WelcomeBanner />);
    expect(container.firstChild).toBeNull();
  });

  it("starts the tour", () => {
    render(<WelcomeBanner />);
    fireEvent.click(screen.getByText("Take the tour"));
    expect(useOnboarding.getState().tourStep).toBe(0);
  });

  it("dismisses and invokes the AI settings callback", () => {
    const onOpenAiSettings = vi.fn();
    render(<WelcomeBanner onOpenAiSettings={onOpenAiSettings} />);
    fireEvent.click(screen.getByText("Set up AI"));
    expect(useOnboarding.getState().welcomeBannerDismissed).toBe(true);
    expect(onOpenAiSettings).toHaveBeenCalled();
  });

  it("dismisses via the dismiss button", () => {
    render(<WelcomeBanner />);
    fireEvent.click(screen.getByLabelText("Dismiss welcome banner"));
    expect(useOnboarding.getState().welcomeBannerDismissed).toBe(true);
  });
});
