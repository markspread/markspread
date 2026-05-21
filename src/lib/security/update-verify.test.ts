// S-SE-036..039: update-verify preflight + downgrade gate.

import { describe, expect, it } from "vitest";
import { type UpdateManifest, isDowngrade, preflightUpdate } from "./update-verify";

function manifest(version: string): UpdateManifest {
  return {
    version,
    notesMarkdown: "",
    pubDate: "2025-01-01T00:00:00Z",
    platforms: {},
    signature: "",
  };
}

describe("isDowngrade", () => {
  it("returns false when either version is unparseable", () => {
    expect(isDowngrade("not-semver", "1.0.0")).toBe(false);
    expect(isDowngrade("1.0.0", "garbage")).toBe(false);
  });

  it("compares the major component first", () => {
    expect(isDowngrade("2.0.0", "1.9.9")).toBe(true);
    expect(isDowngrade("1.0.0", "2.0.0")).toBe(false);
  });

  it("falls through to minor when major ties", () => {
    expect(isDowngrade("1.5.0", "1.4.9")).toBe(true);
    expect(isDowngrade("1.4.0", "1.5.0")).toBe(false);
  });

  it("falls through to patch when major and minor tie", () => {
    expect(isDowngrade("1.2.3", "1.2.2")).toBe(true);
    expect(isDowngrade("1.2.2", "1.2.3")).toBe(false);
    expect(isDowngrade("1.2.3", "1.2.3")).toBe(false);
  });
});

describe("preflightUpdate", () => {
  it("rejects manifests whose version isn't a SemVer triple", () => {
    const r = preflightUpdate("1.0.0", manifest("bad-version"));
    expect(r).toEqual({
      ok: false,
      code: "manifest-malformed",
      message: "version is not a SemVer triple",
    });
  });

  it("blocks downgrades", () => {
    const r = preflightUpdate("1.5.0", manifest("1.4.0"));
    expect(r).toEqual({
      ok: false,
      code: "downgrade-blocked",
      current: "1.5.0",
      candidate: "1.4.0",
    });
  });

  it("approves a forward upgrade", () => {
    const r = preflightUpdate("1.4.0", manifest("1.5.0"));
    expect(r).toEqual({ ok: true, targetVersion: "1.5.0" });
  });
});
