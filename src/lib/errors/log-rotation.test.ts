// Unit tests for log rotation configuration helpers.

import { beforeEach, describe, expect, it, vi } from "vitest";

const invokeMock = vi.fn();
vi.mock("@tauri-apps/api/core", () => ({
  invoke: (...args: unknown[]) => invokeMock(...args),
}));

import {
  APP_LOG_ROTATION,
  CRASH_LOG_ROTATION,
  applyLogRotation,
  logLocations,
} from "./log-rotation";

beforeEach(() => {
  invokeMock.mockReset();
});

describe("rotation config constants", () => {
  it("caps the app log at 5 MB and keeps 5 files", () => {
    expect(APP_LOG_ROTATION.maxBytes).toBe(5 * 1024 * 1024);
    expect(APP_LOG_ROTATION.keep).toBe(5);
    expect(APP_LOG_ROTATION.checkIntervalSec).toBe(30);
  });

  it("caps the crash log at 2 MB", () => {
    expect(CRASH_LOG_ROTATION.maxBytes).toBe(2 * 1024 * 1024);
    expect(CRASH_LOG_ROTATION.keep).toBe(10);
  });
});

describe("applyLogRotation", () => {
  it("invokes logger_set_rotation with both configs", async () => {
    invokeMock.mockResolvedValue(undefined);
    await applyLogRotation();
    expect(invokeMock).toHaveBeenCalledWith("logger_set_rotation", {
      appLog: APP_LOG_ROTATION,
      crashLog: CRASH_LOG_ROTATION,
    });
  });
});

describe("logLocations", () => {
  it("returns the IPC payload", async () => {
    const locations = { appLogPath: "/logs/app.log", crashLogDir: "/logs/crash" };
    invokeMock.mockResolvedValue(locations);
    expect(await logLocations()).toEqual(locations);
    expect(invokeMock).toHaveBeenCalledWith("logger_locations");
  });
});
