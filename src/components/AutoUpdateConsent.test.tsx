import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const invokeMock = vi.fn();
vi.mock("@tauri-apps/api/core", () => ({
  invoke: (cmd: string) => invokeMock(cmd),
}));

import { useUpdater } from "../store/updater";
import { AutoUpdateConsent } from "./AutoUpdateConsent";

afterEach(cleanup);

describe("AutoUpdateConsent", () => {
  beforeEach(() => {
    invokeMock.mockReset();
    useUpdater.setState({ consent: "unset", firstRunPromptShown: false });
  });
  afterEach(() => {
    useUpdater.setState({ consent: "unset", firstRunPromptShown: false });
  });

  it("renders nothing while portable status is unknown", () => {
    invokeMock.mockReturnValue(new Promise(() => {}));
    const { container } = render(<AutoUpdateConsent />);
    expect(container.firstChild).toBeNull();
  });

  it("shows the consent dialog for a non-portable install", async () => {
    invokeMock.mockResolvedValue(false);
    render(<AutoUpdateConsent />);
    await waitFor(() => expect(screen.getByRole("dialog")).toBeTruthy());
    expect(screen.getByText("Enable automatic updates?")).toBeTruthy();
  });

  it("records deny when Decline is clicked", async () => {
    invokeMock.mockResolvedValue(false);
    render(<AutoUpdateConsent />);
    await waitFor(() => expect(screen.getByRole("dialog")).toBeTruthy());
    screen.getByText("Decline").click();
    await waitFor(() => expect(useUpdater.getState().consent).toBe("deny"));
  });

  it("renders nothing once consent already set", () => {
    invokeMock.mockResolvedValue(false);
    useUpdater.setState({ consent: "allow", firstRunPromptShown: true });
    const { container } = render(<AutoUpdateConsent />);
    expect(container.firstChild).toBeNull();
  });
});
