import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { useTelemetry } from "../store/telemetry";
import { useUpdater } from "../store/updater";
import { TelemetryConsent } from "./TelemetryConsent";

afterEach(cleanup);

describe("TelemetryConsent", () => {
  beforeEach(() => {
    useTelemetry.setState({ consent: "unset", firstRunPromptShown: false });
    useUpdater.setState({ consent: "allow", firstRunPromptShown: true });
  });

  it("renders when the updater prompt is resolved and consent is unset", () => {
    render(<TelemetryConsent />);
    expect(screen.getByText("Send anonymous usage statistics?")).toBeTruthy();
  });

  it("stays hidden until the updater prompt has shown", () => {
    useUpdater.setState({ firstRunPromptShown: false });
    const { container } = render(<TelemetryConsent />);
    expect(container.firstChild).toBeNull();
  });

  it("records an enabled choice", () => {
    render(<TelemetryConsent />);
    fireEvent.click(screen.getByText("Send"));
    expect(useTelemetry.getState().consent).toBe("enabled");
  });

  it("records a disabled choice", () => {
    render(<TelemetryConsent />);
    fireEvent.click(screen.getByText("Don't send"));
    expect(useTelemetry.getState().consent).toBe("disabled");
  });
});
