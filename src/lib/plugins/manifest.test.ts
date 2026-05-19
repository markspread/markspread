// S-TST: manifest validator + semver range checks — explicit non-fuzz
// coverage complementing manifest.fuzz.test.ts.

import { describe, expect, it } from "vitest";
import { PluginIdCollisionError, isHostCompatible, validateManifest } from "./manifest";

function base(): Record<string, unknown> {
  return {
    id: "good-plugin",
    name: "Good Plugin",
    version: "1.2.3",
    kind: "parser",
    engines: { markspread: "^1.0.0" },
    activationEvents: ["onStartup"],
    permissions: ["fs.workspace-read"],
  };
}

describe("validateManifest", () => {
  it("accepts a well-formed manifest", () => {
    const res = validateManifest(base());
    expect(res.ok).toBe(true);
    if (res.ok) expect(res.value.id).toBe("good-plugin");
  });

  it("rejects non-objects", () => {
    expect(validateManifest(null).ok).toBe(false);
    expect(validateManifest(42).ok).toBe(false);
    expect(validateManifest([]).ok).toBe(false);
  });

  it("reports every missing required field", () => {
    const res = validateManifest({});
    expect(res.ok).toBe(false);
    if (!res.ok) {
      expect(res.errors).toHaveLength(7);
      expect(res.errors.every((e) => e.message === "required field missing")).toBe(true);
    }
  });

  it("rejects an invalid id", () => {
    const res = validateManifest({ ...base(), id: "_Bad" });
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.errors.some((e) => e.path === "id")).toBe(true);
  });

  it("rejects an empty or overlong name", () => {
    expect(validateManifest({ ...base(), name: "" }).ok).toBe(false);
    expect(validateManifest({ ...base(), name: "x".repeat(81) }).ok).toBe(false);
  });

  it("rejects a non-semver version", () => {
    const res = validateManifest({ ...base(), version: "v1" });
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.errors.some((e) => e.path === "version")).toBe(true);
  });

  it("rejects an unknown kind", () => {
    const res = validateManifest({ ...base(), kind: "wizard" });
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.errors.some((e) => e.path === "kind")).toBe(true);
  });

  it("rejects a missing engines.markspread", () => {
    const res = validateManifest({ ...base(), engines: {} });
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.errors.some((e) => e.path === "engines.markspread")).toBe(true);
  });

  it("rejects non-array activationEvents", () => {
    const res = validateManifest({ ...base(), activationEvents: "onStartup" });
    expect(res.ok).toBe(false);
  });

  it("rejects a non-string activation event entry", () => {
    const res = validateManifest({ ...base(), activationEvents: [42] });
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.errors.some((e) => e.path === "activationEvents[0]")).toBe(true);
  });

  it("rejects an unknown activation event string", () => {
    const res = validateManifest({ ...base(), activationEvents: ["onWhatever"] });
    expect(res.ok).toBe(false);
  });

  it("accepts every valid activation prefix", () => {
    const res = validateManifest({
      ...base(),
      activationEvents: ["onStartup", "onLanguage:md", "onCommand:x", "onView:y"],
    });
    expect(res.ok).toBe(true);
  });

  it("rejects non-array permissions", () => {
    expect(validateManifest({ ...base(), permissions: "fs" }).ok).toBe(false);
  });

  it("rejects an unknown string permission", () => {
    const res = validateManifest({ ...base(), permissions: ["fs.nope"] });
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.errors.some((e) => e.path === "permissions[0]")).toBe(true);
  });

  it("accepts object permissions for network and keychain", () => {
    const res = validateManifest({
      ...base(),
      permissions: [{ network: ["example.com"] }, { keychain: ["openai"] }],
    });
    expect(res.ok).toBe(true);
  });

  it("rejects an object permission with neither network nor keychain", () => {
    const res = validateManifest({ ...base(), permissions: [{ foo: [] }] });
    expect(res.ok).toBe(false);
  });

  it("accepts the shell permission string (gate denies it later)", () => {
    expect(validateManifest({ ...base(), permissions: ["shell"] }).ok).toBe(true);
  });
});

describe("isHostCompatible", () => {
  it("rejects an unparseable host version", () => {
    expect(isHostCompatible("nope", "^1.0.0")).toBe(false);
  });

  it("handles caret ranges", () => {
    expect(isHostCompatible("1.4.0", "^1.0.0")).toBe(true);
    expect(isHostCompatible("1.0.0", "^1.4.0")).toBe(false);
    expect(isHostCompatible("2.0.0", "^1.0.0")).toBe(false);
    expect(isHostCompatible("1.0.0", "^nope")).toBe(false);
  });

  it("handles tilde ranges", () => {
    expect(isHostCompatible("1.2.5", "~1.2.0")).toBe(true);
    expect(isHostCompatible("1.3.0", "~1.2.0")).toBe(false);
    expect(isHostCompatible("1.2.0", "~1.2.5")).toBe(false);
    expect(isHostCompatible("1.2.0", "~bad")).toBe(false);
  });

  it("handles >= ranges", () => {
    expect(isHostCompatible("2.0.0", ">=1.0.0")).toBe(true);
    expect(isHostCompatible("0.9.0", ">=1.0.0")).toBe(false);
    expect(isHostCompatible("1.0.0", ">=bad")).toBe(false);
  });

  it("handles exact ranges", () => {
    expect(isHostCompatible("1.2.3", "1.2.3")).toBe(true);
    expect(isHostCompatible("1.2.4", "1.2.3")).toBe(false);
    expect(isHostCompatible("1.0.0", "bad")).toBe(false);
  });
});

describe("PluginIdCollisionError", () => {
  it("captures id and both paths", () => {
    const err = new PluginIdCollisionError("dup", "/a/manifest.json", "/b/manifest.json");
    expect(err.id).toBe("dup");
    expect(err.existingPath).toBe("/a/manifest.json");
    expect(err.newPath).toBe("/b/manifest.json");
    expect(err.name).toBe("PluginIdCollisionError");
    expect(err.message).toContain("dup");
    expect(err).toBeInstanceOf(Error);
  });
});
