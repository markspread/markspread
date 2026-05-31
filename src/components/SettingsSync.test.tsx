// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { SettingsSync } from "./SettingsSync";

afterEach(cleanup);

describe("SettingsSync — inactive subscription (default)", () => {
  it("shows Inactive badge + subscribe CTA", () => {
    render(<SettingsSync />);
    expect(screen.getByTestId("sync-tier-badge").textContent).toBe("Inactive");
    expect(screen.getByTestId("sync-manage-link").textContent).toMatch(/구독 시작/);
  });

  it("hides sync-now and setup-encryption when inactive", () => {
    render(<SettingsSync />);
    expect(screen.queryByTestId("sync-now-button")).toBeNull();
    expect(screen.queryByTestId("sync-setup-encryption")).toBeNull();
  });

  it("shows zero devices and encryption pending", () => {
    render(<SettingsSync />);
    expect(screen.getByTestId("sync-device-count").textContent).toBe("0");
    expect(screen.getByTestId("sync-encryption-status").textContent).toMatch(/Pending/);
  });
});

describe("SettingsSync — active subscription", () => {
  it("active without encryption shows setup CTA", () => {
    const onSetup = vi.fn();
    render(
      <SettingsSync
        status={{ active: true, deviceCount: 1, encryptionReady: false }}
        onSetupEncryption={onSetup}
      />,
    );
    const btn = screen.getByTestId("sync-setup-encryption");
    expect(btn).toBeTruthy();
    fireEvent.click(btn);
    expect(onSetup).toHaveBeenCalledOnce();
    expect(screen.queryByTestId("sync-now-button")).toBeNull();
  });

  it("active with encryption shows sync-now button", () => {
    const onSync = vi.fn();
    render(
      <SettingsSync
        status={{
          active: true,
          deviceCount: 2,
          encryptionReady: true,
          lastSyncAt: "2026-06-01T12:30:00Z",
        }}
        onSyncNow={onSync}
      />,
    );
    fireEvent.click(screen.getByTestId("sync-now-button"));
    expect(onSync).toHaveBeenCalledOnce();
  });

  it("displays last sync timestamp", () => {
    render(
      <SettingsSync
        status={{
          active: true,
          deviceCount: 1,
          encryptionReady: true,
          lastSyncAt: "2026-06-01T12:30:00Z",
        }}
      />,
    );
    const t = screen.getByTestId("sync-last-at");
    expect(t.textContent).toBe("2026-06-01 12:30:00");
  });

  it("badge shows $5/mo when active", () => {
    render(<SettingsSync status={{ active: true, deviceCount: 1, encryptionReady: true }} />);
    expect(screen.getByTestId("sync-tier-badge").textContent).toBe("$5/mo");
  });

  it("manage link label = 구독 관리 when active", () => {
    render(<SettingsSync status={{ active: true, deviceCount: 1, encryptionReady: true }} />);
    expect(screen.getByTestId("sync-manage-link").textContent).toMatch(/관리/);
  });
});
