// Unit tests for the migration adapter registry + run wrapper.

import { beforeEach, describe, expect, it, vi } from "vitest";

const invokeMock = vi.fn();
vi.mock("@tauri-apps/api/core", () => ({
  invoke: (...args: unknown[]) => invokeMock(...args),
}));

import {
  MIGRATION_ADAPTERS,
  type MigrationRunRequest,
  type MigrationSource,
  runMigration,
} from "./migrate";

beforeEach(() => {
  invokeMock.mockReset();
});

describe("MIGRATION_ADAPTERS", () => {
  it("registers all five sources", () => {
    const sources = MIGRATION_ADAPTERS.map((a) => a.source).sort();
    expect(sources).toEqual<MigrationSource[]>([
      "ia-writer",
      "logseq",
      "notion",
      "obsidian",
      "typora",
    ]);
  });

  it("each adapter has a label, an expects kind, and three note buckets", () => {
    for (const a of MIGRATION_ADAPTERS) {
      expect(a.label.length).toBeGreaterThan(0);
      expect(["folder", "zip"]).toContain(a.expects);
      expect(Array.isArray(a.notes.mapped)).toBe(true);
      expect(Array.isArray(a.notes.skipped)).toBe(true);
      expect(Array.isArray(a.notes.partial)).toBe(true);
      expect(a.notes.mapped.length).toBeGreaterThan(0);
    }
  });

  it("notion is delivered as a zip", () => {
    const notion = MIGRATION_ADAPTERS.find((a) => a.source === "notion");
    expect(notion?.expects).toBe("zip");
  });
});

describe("runMigration", () => {
  it("invokes migrate_run and returns the result", async () => {
    const req: MigrationRunRequest = {
      source: "obsidian",
      inputPath: "/vault",
      outputPath: "/workspace",
      copyFiles: true,
    };
    const result = {
      filesProcessed: 3,
      filesWritten: 3,
      warnings: [],
      errors: [],
    };
    invokeMock.mockResolvedValue(result);
    expect(await runMigration(req)).toEqual(result);
    expect(invokeMock).toHaveBeenCalledWith("migrate_run", { req });
  });
});
