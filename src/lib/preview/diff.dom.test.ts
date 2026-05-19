// Coverage for the LCS-based markdown line diff.

import { describe, expect, it } from "vitest";
import { diffMarkdown } from "./diff";

describe("diffMarkdown", () => {
  it("reports all rows as 'same' for identical input", () => {
    const r = diffMarkdown("a\nb\nc", "a\nb\nc");
    expect(r.left.every((row) => row.kind === "same")).toBe(true);
    expect(r.right.every((row) => row.kind === "same")).toBe(true);
    expect(r.stats).toEqual({ adds: 0, dels: 0 });
    expect(r.left[0]?.line).toBe(1);
    expect(r.left[2]?.line).toBe(3);
  });

  it("detects a pure addition with a pad on the left", () => {
    const r = diffMarkdown("a", "a\nb");
    expect(r.stats.adds).toBe(1);
    expect(r.stats.dels).toBe(0);
    const pad = r.left.find((row) => row.kind === "pad");
    expect(pad).toBeDefined();
    expect(pad?.line).toBeNull();
    const add = r.right.find((row) => row.kind === "add");
    expect(add?.text).toBe("b");
  });

  it("detects a pure deletion with a pad on the right", () => {
    const r = diffMarkdown("a\nb", "a");
    expect(r.stats.dels).toBe(1);
    expect(r.stats.adds).toBe(0);
    const del = r.left.find((row) => row.kind === "del");
    expect(del?.text).toBe("b");
    const pad = r.right.find((row) => row.kind === "pad");
    expect(pad?.line).toBeNull();
  });

  it("handles a replacement (del + add)", () => {
    const r = diffMarkdown("a\nold\nc", "a\nnew\nc");
    expect(r.stats.adds).toBe(1);
    expect(r.stats.dels).toBe(1);
  });

  it("handles two empty inputs", () => {
    const r = diffMarkdown("", "");
    // each empty string splits to one empty line.
    expect(r.left).toHaveLength(1);
    expect(r.right).toHaveLength(1);
    expect(r.left[0]?.kind).toBe("same");
  });

  it("handles CRLF line endings", () => {
    const r = diffMarkdown("a\r\nb", "a\r\nb");
    expect(r.left).toHaveLength(2);
    expect(r.stats).toEqual({ adds: 0, dels: 0 });
  });

  it("handles a fully replaced document", () => {
    const r = diffMarkdown("x\ny", "p\nq");
    expect(r.stats.adds).toBe(2);
    expect(r.stats.dels).toBe(2);
  });

  it("trailing additions are appended after the common prefix", () => {
    const r = diffMarkdown("a", "a\nb\nc");
    expect(r.stats.adds).toBe(2);
    expect(r.right.filter((row) => row.kind === "add")).toHaveLength(2);
  });

  it("trailing deletions are appended after the common prefix", () => {
    const r = diffMarkdown("a\nb\nc", "a");
    expect(r.stats.dels).toBe(2);
    expect(r.left.filter((row) => row.kind === "del")).toHaveLength(2);
  });
});
