// S-UP-001 boot wiring: updater scheduler coverage.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { UpdateManifest } from "../security/update-verify";

const checkForUpdate = vi.fn<(channel: string) => Promise<UpdateManifest | null>>();
const startDownload = vi.fn<(m: UpdateManifest) => Promise<void>>();
const getState = vi.fn<() => { consent: string }>();

vi.mock("./updater", () => ({
  checkForUpdate: (...args: [string]) => checkForUpdate(...args),
  startDownload: (...args: [UpdateManifest]) => startDownload(...args),
}));
vi.mock("../../store/updater", () => ({
  useUpdater: { getState: () => getState() },
}));

function manifest(): UpdateManifest {
  return {
    version: "1.0.1",
    notesMarkdown: "",
    pubDate: "2026-01-01T00:00:00Z",
    platforms: {},
    signature: "s",
  };
}

async function loadScheduler() {
  vi.resetModules();
  return import("./scheduler");
}

beforeEach(() => {
  vi.useFakeTimers();
  checkForUpdate.mockReset();
  startDownload.mockReset();
  getState.mockReset();
  getState.mockReturnValue({ consent: "unset" });
});

afterEach(() => {
  vi.useRealTimers();
});

describe("startUpdaterScheduler", () => {
  it("runs the first check after the boot delay", async () => {
    checkForUpdate.mockResolvedValue(null);
    const { startUpdaterScheduler } = await loadScheduler();
    startUpdaterScheduler();
    expect(checkForUpdate).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(5_000);
    expect(checkForUpdate).toHaveBeenCalledWith("stable");
  });

  it("downloads automatically when consent is allow", async () => {
    checkForUpdate.mockResolvedValue(manifest());
    startDownload.mockResolvedValue(undefined);
    getState.mockReturnValue({ consent: "allow" });
    const { startUpdaterScheduler } = await loadScheduler();
    startUpdaterScheduler();
    await vi.advanceTimersByTimeAsync(5_000);
    expect(startDownload).toHaveBeenCalledTimes(1);
  });

  it("does not download when consent is not allow", async () => {
    checkForUpdate.mockResolvedValue(manifest());
    getState.mockReturnValue({ consent: "deny" });
    const { startUpdaterScheduler } = await loadScheduler();
    startUpdaterScheduler();
    await vi.advanceTimersByTimeAsync(5_000);
    expect(startDownload).not.toHaveBeenCalled();
  });

  it("returns early when no manifest is available", async () => {
    checkForUpdate.mockResolvedValue(null);
    getState.mockReturnValue({ consent: "allow" });
    const { startUpdaterScheduler } = await loadScheduler();
    startUpdaterScheduler();
    await vi.advanceTimersByTimeAsync(5_000);
    expect(startDownload).not.toHaveBeenCalled();
  });

  it("re-checks every 6 hours", async () => {
    checkForUpdate.mockResolvedValue(null);
    const { startUpdaterScheduler } = await loadScheduler();
    startUpdaterScheduler();
    await vi.advanceTimersByTimeAsync(5_000);
    expect(checkForUpdate).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(6 * 60 * 60 * 1_000);
    expect(checkForUpdate).toHaveBeenCalledTimes(2);
  });

  it("swallows check failures without throwing", async () => {
    checkForUpdate.mockRejectedValue(new Error("network down"));
    const { startUpdaterScheduler } = await loadScheduler();
    startUpdaterScheduler();
    await vi.advanceTimersByTimeAsync(5_000);
    expect(checkForUpdate).toHaveBeenCalled();
    expect(startDownload).not.toHaveBeenCalled();
  });

  it("is idempotent — a second call does not schedule again", async () => {
    checkForUpdate.mockResolvedValue(null);
    const { startUpdaterScheduler } = await loadScheduler();
    startUpdaterScheduler();
    startUpdaterScheduler();
    await vi.advanceTimersByTimeAsync(5_000);
    expect(checkForUpdate).toHaveBeenCalledTimes(1);
  });
});
