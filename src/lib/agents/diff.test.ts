// MAR-1011: LCS-based diff helper tests.

import { describe, expect, it } from "vitest";
import { buildLineDiff, formatUnifiedDiff } from "./diff";

describe("buildLineDiff", () => {
  it("returns an empty list when both sides are empty", () => {
    expect(buildLineDiff("", "")).toEqual([]);
  });

  it("treats identical inputs as all context", () => {
    const out = buildLineDiff("a\nb", "a\nb");
    expect(out).toEqual([
      { kind: "context", text: "a" },
      { kind: "context", text: "b" },
    ]);
  });

  it("reports pure additions", () => {
    const out = buildLineDiff("", "a\nb");
    expect(out.filter((l) => l.kind === "add")).toHaveLength(2);
  });

  it("reports pure removals", () => {
    const out = buildLineDiff("a\nb", "");
    expect(out.filter((l) => l.kind === "remove")).toHaveLength(2);
  });

  it("preserves a common prefix and suffix around a change", () => {
    const out = buildLineDiff("a\nb\nc", "a\nB\nc");
    const kinds = out.map((l) => l.kind);
    expect(kinds).toContain("remove");
    expect(kinds).toContain("add");
    expect(out[0]).toEqual({ kind: "context", text: "a" });
    expect(out[out.length - 1]).toEqual({ kind: "context", text: "c" });
  });

  it("handles a single-line replacement", () => {
    const out = buildLineDiff("foo", "bar");
    expect(out.some((l) => l.kind === "remove" && l.text === "foo")).toBe(true);
    expect(out.some((l) => l.kind === "add" && l.text === "bar")).toBe(true);
  });

  it("emits trailing removals when `a` is longer than `b`", () => {
    // Common prefix `x`, then a runs out additional lines `y` and `z`.
    const out = buildLineDiff("x\ny\nz", "x");
    expect(out.filter((l) => l.kind === "remove").map((l) => l.text)).toEqual(["y", "z"]);
  });

  it("emits trailing additions when `b` is longer than `a`", () => {
    const out = buildLineDiff("x", "x\ny\nz");
    expect(out.filter((l) => l.kind === "add").map((l) => l.text)).toEqual(["y", "z"]);
  });
});

describe("formatUnifiedDiff", () => {
  it("emits a/b header and +/-/space line prefixes", () => {
    const u = formatUnifiedDiff("notes/x.md", "old", "new");
    expect(u).toContain("--- a/notes/x.md");
    expect(u).toContain("+++ b/notes/x.md");
    expect(u).toContain("-old");
    expect(u).toContain("+new");
  });

  it("uses a leading space for context lines", () => {
    const u = formatUnifiedDiff("a", "shared\nold", "shared\nnew");
    expect(u).toContain(" shared");
  });
});
