// S-TST-003: SDK helper unit tests.
//
// Pure logic only — `locateInJson` walks dotted paths to compute
// line/column offsets for manifest violations, and `createRecordingBridge`
// is the test double the SDK exposes so plugin authors can simulate host
// IPC without spinning up a Tauri runtime. Both are deterministic and
// don't need jsdom.

import { describe, expect, it } from "vitest";
import { createRecordingBridge, locateInJson } from "./sdk";

describe("locateInJson", () => {
  it("returns 1:1 fallback for an empty path", () => {
    const src = `{"id": "x"}`;
    expect(locateInJson(src, "")).toEqual({ line: 1, column: 1 });
  });

  it("finds a top-level key", () => {
    const src = `{\n  "id": "x",\n  "engines": {"markspread": "^1.0"}\n}`;
    const loc = locateInJson(src, "engines.markspread");
    expect(loc.line).toBe(3);
    // pointer should land somewhere inside the engines value, not the literal "engines"
    expect(loc.column).toBeGreaterThan(1);
  });

  it("walks bracketed indices", () => {
    const src = `{\n  "permissions": [\n    "fs.read",\n    "net"\n  ]\n}`;
    const loc = locateInJson(src, "permissions[1]");
    expect(loc.line).toBeGreaterThanOrEqual(3);
  });

  it("returns 1:1 for a path that isn't present", () => {
    const src = `{"id": "x"}`;
    expect(locateInJson(src, "engines.markspread")).toEqual({ line: 1, column: 1 });
  });
});

describe("createRecordingBridge", () => {
  it("records every host call in order", async () => {
    const bridge = createRecordingBridge();
    bridge.respond("hello", () => ({ greeting: "hi" }));
    const result = await bridge.invoke("hello", { name: "ada" });
    expect(result).toEqual({ greeting: "hi" });
    expect(bridge.calls).toEqual([{ command: "hello", payload: { name: "ada" } }]);
  });

  it("rejects unknown commands so tests can't silently pass", async () => {
    const bridge = createRecordingBridge();
    await expect(bridge.invoke("missing", {})).rejects.toThrow(/missing/);
  });

  it("clears recorded calls on reset", () => {
    const bridge = createRecordingBridge();
    bridge.respond("noop", () => null);
    bridge.invoke("noop", {}).catch(() => {});
    bridge.reset();
    expect(bridge.calls).toHaveLength(0);
  });
});
