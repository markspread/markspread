// S-PSDK-001: ParserManifest 검증 회귀.

import { describe, expect, it } from "vitest";
import { parseManifest } from "../manifest";

const valid = {
  id: "csv-table",
  version: "0.1.0",
  displayName: "CSV Table",
  fileMatch: { extensions: [".csv"] },
  capabilities: "preview-plus-edit" as const,
  entry: "./dist/parser.js",
};

describe("parseManifest", () => {
  it("accepts a minimal valid manifest", () => {
    const result = parseManifest(valid);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.manifest.id).toBe("csv-table");
      expect(result.manifest.fileMatch.extensions).toEqual([".csv"]);
    }
  });

  it("accepts fileMatch declared via globs only", () => {
    const result = parseManifest({
      ...valid,
      fileMatch: { globs: ["docs/**/*.csv"] },
    });
    expect(result.ok).toBe(true);
  });

  it("accepts fileMatch declared via frontmatterSniff only", () => {
    const result = parseManifest({
      ...valid,
      fileMatch: { frontmatterSniff: { type: "diagram" } },
    });
    expect(result.ok).toBe(true);
  });

  it("rejects fileMatch with no extensions, globs, or sniff", () => {
    const result = parseManifest({ ...valid, fileMatch: {} });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.issues.some((i) => i.message.includes("fileMatch"))).toBe(true);
    }
  });

  it("rejects fileMatch with empty extensions array", () => {
    const result = parseManifest({ ...valid, fileMatch: { extensions: [] } });
    expect(result.ok).toBe(false);
  });

  it("rejects extension missing the leading dot", () => {
    const result = parseManifest({
      ...valid,
      fileMatch: { extensions: ["csv"] },
    });
    expect(result.ok).toBe(false);
  });

  it("rejects malformed semver", () => {
    const result = parseManifest({ ...valid, version: "1.0" });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.issues.some((i) => i.path === "version")).toBe(true);
    }
  });

  it("accepts semver with pre-release suffix", () => {
    const result = parseManifest({ ...valid, version: "1.2.3-beta.1" });
    expect(result.ok).toBe(true);
  });

  it("rejects an id with uppercase letters", () => {
    const result = parseManifest({ ...valid, id: "CSV-Table" });
    expect(result.ok).toBe(false);
  });

  it("rejects an unknown capability", () => {
    const result = parseManifest({ ...valid, capabilities: "write-only" });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.issues.some((i) => i.path === "capabilities")).toBe(true);
    }
  });

  it("rejects empty displayName", () => {
    const result = parseManifest({ ...valid, displayName: "" });
    expect(result.ok).toBe(false);
  });

  it("rejects empty entry path", () => {
    const result = parseManifest({ ...valid, entry: "" });
    expect(result.ok).toBe(false);
  });

  it("collects multiple issues at once", () => {
    const result = parseManifest({
      id: "Bad ID",
      version: "x.y.z",
      displayName: "",
      fileMatch: {},
      capabilities: "preview-only",
      entry: "./e.js",
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.issues.length).toBeGreaterThanOrEqual(3);
    }
  });
});
