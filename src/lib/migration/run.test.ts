// Unit tests for the schema-migration boot wiring.

import { beforeEach, describe, expect, it, vi } from "vitest";

const invokeMock = vi.fn();
vi.mock("@tauri-apps/api/core", () => ({
  invoke: (...args: unknown[]) => invokeMock(...args),
}));

import { CURRENT_SCHEMA_VERSION, runMigration } from "./run";

beforeEach(() => {
  invokeMock.mockReset();
});

describe("runMigration", () => {
  it("exposes the current schema version", () => {
    expect(CURRENT_SCHEMA_VERSION).toBe(1);
  });

  it("invokes migration_run with the current schema version", async () => {
    invokeMock.mockResolvedValue(undefined);
    await runMigration();
    expect(invokeMock).toHaveBeenCalledWith("migration_run", {
      schemaVersion: CURRENT_SCHEMA_VERSION,
    });
  });

  it("swallows IPC errors and warns instead of throwing", async () => {
    invokeMock.mockRejectedValue(new Error("handler not wired"));
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    await expect(runMigration()).resolves.toBeUndefined();
    expect(warn).toHaveBeenCalledWith("[migration] run failed", expect.any(Error));
  });
});
