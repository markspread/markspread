// S-PL-SEC-001: manifest validation regression tests for ADR-0012.

import { describe, expect, it } from "vitest";
import {
  isEntryWithinPluginDir,
  isHostCompatible,
  parseManifest,
  parseManifestText,
} from "../loader";

const valid = {
  schemaVersion: 1,
  name: "wireweave",
  version: "0.3.1",
  entry: "./index.js",
  permissions: [],
  allowedHosts: [],
  contributes: { codeblocks: { wireweave: { render: "html" } } },
  render: "html",
  engines: { markspread: ">=1.3.0" },
};

describe("parseManifest", () => {
  it("accepts a valid minimal manifest", () => {
    const r = parseManifest(valid);
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.value.name).toBe("wireweave");
      expect(r.value.contributes.codeblocks?.wireweave?.render).toBe("html");
    }
  });

  it("accepts custom fences and inline rules", () => {
    const r = parseManifest({
      ...valid,
      contributes: {
        fences: [{ name: "note", render: "html" }],
        inlineRules: [{ pattern: "@(\\w+)", flags: "g", render: "html" }],
        headers: { h1: { render: "html" } },
      },
    });
    expect(r.ok).toBe(true);
  });

  it("rejects bad name", () => {
    const r = parseManifest({ ...valid, name: "Invalid Name!" });
    expect(r.ok).toBe(false);
  });

  it("rejects bad version", () => {
    const r = parseManifest({ ...valid, version: "1.2" });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors[0]?.path).toBe("version");
  });

  it("rejects unknown permissions", () => {
    const r = parseManifest({ ...valid, permissions: ["network", "fs:exec"] });
    expect(r.ok).toBe(false);
  });

  it("rejects network permission without allowedHosts", () => {
    const r = parseManifest({ ...valid, permissions: ["network"], allowedHosts: [] });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors[0]?.path).toBe("allowedHosts");
  });

  it("accepts network permission with allowedHosts", () => {
    const r = parseManifest({
      ...valid,
      permissions: ["network"],
      allowedHosts: ["api.example.com"],
    });
    expect(r.ok).toBe(true);
  });

  it("ignores forward-compat unknown top-level fields", () => {
    const r = parseManifest({ ...valid, futureField: { exotic: 1 } });
    expect(r.ok).toBe(true);
  });

  it("rejects missing schemaVersion (=1)", () => {
    const r = parseManifest({ ...valid, schemaVersion: 2 });
    expect(r.ok).toBe(false);
  });

  it("rejects empty $ root path with non-object input", () => {
    const r = parseManifest("not-an-object");
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors[0]?.path).toBe("$");
  });
});

describe("parseManifestText", () => {
  it("validates raw JSON", () => {
    const r = parseManifestText(JSON.stringify(valid));
    expect(r.ok).toBe(true);
  });

  it("reports JSON parse failure", () => {
    const r = parseManifestText("not json");
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors[0]?.message).toMatch(/JSON parse/);
  });

  it("rejects path-traversal entry", () => {
    const bad = { ...valid, entry: "../escape.js" };
    const r = parseManifestText(JSON.stringify(bad));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors[0]?.path).toBe("entry");
  });

  it("passes through deeper schema errors before path check", () => {
    const bad = { ...valid, name: "BAD!!" };
    const r = parseManifestText(JSON.stringify(bad));
    expect(r.ok).toBe(false);
  });
});

describe("isEntryWithinPluginDir", () => {
  it.each([
    ["./index.js", true],
    ["index.js", true],
    ["dist/index.js", true],
    ["nested/dir/file.js", true],
    ["", false],
    ["/abs/path", false],
    ["C:/win/abs", false],
    ["d:\\win\\abs", false],
    ["../escape.js", false],
    ["dir/../escape.js", false],
    ["valid\\backslash\\path.js", true],
    ["file\0null.js", false],
  ])("entry %s → %s", (entry, expected) => {
    expect(isEntryWithinPluginDir(entry)).toBe(expected);
  });
});

describe("isHostCompatible", () => {
  it("caret accepts same major, blocks bumps", () => {
    expect(isHostCompatible("1.4.0", "^1.3.0")).toBe(true);
    expect(isHostCompatible("2.0.0", "^1.3.0")).toBe(false);
    expect(isHostCompatible("1.2.0", "^1.3.0")).toBe(false);
  });

  it("tilde restricts to same minor", () => {
    expect(isHostCompatible("1.3.5", "~1.3.0")).toBe(true);
    expect(isHostCompatible("1.4.0", "~1.3.0")).toBe(false);
  });

  it(">= accepts any higher", () => {
    expect(isHostCompatible("2.0.0", ">=1.3.0")).toBe(true);
    expect(isHostCompatible("1.2.0", ">=1.3.0")).toBe(false);
  });

  it("exact match", () => {
    expect(isHostCompatible("1.3.0", "1.3.0")).toBe(true);
    expect(isHostCompatible("1.3.1", "1.3.0")).toBe(false);
  });

  it("returns false on unparseable host", () => {
    expect(isHostCompatible("not.a.version", "^1.3.0")).toBe(false);
  });

  it.each(["^bad", "~bad", ">=bad", "bad"])("returns false on unparseable range %s", (r) => {
    expect(isHostCompatible("1.3.0", r)).toBe(false);
  });
});
