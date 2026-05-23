import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { useTelemetry } from "../store/telemetry";
import { useUpdater } from "../store/updater";
import { TelemetryConsent } from "./TelemetryConsent";

afterEach(cleanup);

describe("TelemetryConsent", () => {
  beforeEach(() => {
    (window as { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__ = {};
    useTelemetry.setState({ consent: "unset", firstRunPromptShown: false });
    useUpdater.setState({ consent: "allow", firstRunPromptShown: true });
  });
  afterEach(() => {
    // biome-ignore lint/performance/noDelete: test cleanup of injected global.
    delete (window as { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__;
  });

  it("renders nothing outside the tauri runtime", () => {
    // biome-ignore lint/performance/noDelete: test cleanup of injected global.
    delete (window as { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__;
    const { container } = render(<TelemetryConsent />);
    expect(container.firstChild).toBeNull();
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

  it("dismisses to disabled on Escape via the focus trap", () => {
    render(<TelemetryConsent />);
    fireEvent.keyDown(window, { key: "Escape" });
    fireEvent.keyDown(document.body, { key: "Escape" });
    const dialog = document.querySelector('[role="dialog"]') as HTMLElement | null;
    if (dialog) fireEvent.keyDown(dialog, { key: "Escape" });
    expect(useTelemetry.getState().consent).toBe("disabled");
  });
});
