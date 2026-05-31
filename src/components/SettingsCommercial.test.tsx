// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { SettingsCommercial } from "./SettingsCommercial";

const NOW = "2026-06-01T00:00:00Z";

afterEach(cleanup);

describe("SettingsCommercial — free tier", () => {
  it("shows Free badge with AGPL label and purchase CTA", () => {
    render(<SettingsCommercial license={null} now={NOW} />);
    expect(screen.getByTestId("commercial-tier-badge").textContent).toBe("Free");
    expect(screen.getByText(/Free.*AGPL/)).toBeTruthy();
    expect(screen.getByTestId("commercial-manage-link").textContent).toMatch(/구매/);
  });

  it("hides recommend banner by default", () => {
    render(<SettingsCommercial license={null} now={NOW} />);
    expect(screen.queryByTestId("commercial-recommend")).toBeNull();
  });

  it("shows recommend banner when recommend=true on free tier", () => {
    render(<SettingsCommercial license={null} now={NOW} recommend />);
    expect(screen.getByTestId("commercial-recommend")).toBeTruthy();
  });
});

describe("SettingsCommercial — commercial tier", () => {
  const lic = {
    customerId: "cus_abc",
    subscriptionId: "sub_xyz",
    startedAt: "2026-01-01T00:00:00Z",
    renewsAt: "2027-01-01T00:00:00Z",
    licenseId: "lic_001",
    organization: "Acme Inc",
  };

  it("shows Commercial badge with organization label", () => {
    render(<SettingsCommercial license={lic} now={NOW} />);
    expect(screen.getByTestId("commercial-tier-badge").textContent).toBe("Commercial");
    expect(screen.getByText(/Acme Inc/)).toBeTruthy();
  });

  it("hides expires-soon when renewal far away", () => {
    render(<SettingsCommercial license={lic} now={NOW} />);
    expect(screen.queryByTestId("commercial-expires-soon")).toBeNull();
  });

  it("shows expires-soon within 30 days", () => {
    const soon = { ...lic, renewsAt: "2026-06-15T00:00:00Z" };
    render(<SettingsCommercial license={soon} now={NOW} />);
    expect(screen.getByTestId("commercial-expires-soon")).toBeTruthy();
  });

  it("manage link encodes customer id", () => {
    render(<SettingsCommercial license={lic} now={NOW} />);
    const link = screen.getByTestId("commercial-manage-link") as HTMLAnchorElement;
    expect(link.href).toContain("customer=cus_abc");
    expect(link.textContent).toMatch(/관리/);
  });

  it("does not show recommend banner on commercial tier", () => {
    render(<SettingsCommercial license={lic} now={NOW} recommend />);
    expect(screen.queryByTestId("commercial-recommend")).toBeNull();
  });
});
