// Unit tests for YAML frontmatter helpers.

import { describe, expect, it } from "vitest";
import { extractTitle, parseFrontmatter } from "./frontmatter";

describe("parseFrontmatter", () => {
  it("returns null when there is no frontmatter fence", () => {
    expect(parseFrontmatter("# Just a heading\n\nbody")).toBeNull();
  });

  it("returns null when the fence is not at the very start", () => {
    expect(parseFrontmatter("prefix\n---\ntitle: x\n---\n")).toBeNull();
  });

  it("parses scalar key/value pairs and strips the fence from the body", () => {
    const res = parseFrontmatter("---\ntitle: Hello\nauthor: Sam\n---\nbody text");
    expect(res).not.toBeNull();
    if (!res) throw new Error("expected result");
    expect(res.fm).toEqual({ title: "Hello", author: "Sam" });
    expect(res.body).toBe("body text");
    expect(res.range.from).toBe(0);
    expect(res.range.to).toBeGreaterThan(0);
  });

  it("handles a fence terminated by end-of-string (no trailing newline)", () => {
    const res = parseFrontmatter("---\ntitle: X\n---");
    expect(res).not.toBeNull();
    if (!res) throw new Error("expected result");
    expect(res.fm.title).toBe("X");
    expect(res.body).toBe("");
  });

  it("handles CRLF line endings", () => {
    const res = parseFrontmatter("---\r\ntitle: CR\r\n---\r\nbody");
    expect(res).not.toBeNull();
    if (!res) throw new Error("expected result");
    expect(res.fm.title).toBe("CR");
  });

  it("unquotes double- and single-quoted scalars", () => {
    const res = parseFrontmatter(`---\na: "double"\nb: 'single'\n---\n`);
    if (!res) throw new Error("expected result");
    expect(res.fm.a).toBe("double");
    expect(res.fm.b).toBe("single");
  });

  it("skips blank lines and comment lines", () => {
    const res = parseFrontmatter("---\n# a comment\n\ntitle: T\n---\n");
    if (!res) throw new Error("expected result");
    expect(res.fm).toEqual({ title: "T" });
  });

  it("skips lines that are not key:value shaped", () => {
    const res = parseFrontmatter("---\nnot a pair\ntitle: T\n---\n");
    if (!res) throw new Error("expected result");
    expect(res.fm).toEqual({ title: "T" });
  });

  it("parses a dash-style list spanning multiple lines", () => {
    const res = parseFrontmatter("---\ntags:\n  - one\n  - two\n---\n");
    if (!res) throw new Error("expected result");
    expect(res.fm.tags).toEqual(["one", "two"]);
  });

  it("treats an empty value with no following list as empty string", () => {
    const res = parseFrontmatter("---\ntags:\ntitle: T\n---\n");
    if (!res) throw new Error("expected result");
    expect(res.fm.tags).toBe("");
    expect(res.fm.title).toBe("T");
  });

  it("parses an inline bracket list and drops empties", () => {
    const res = parseFrontmatter(`---\ntags: [a, "b", '', c]\n---\n`);
    if (!res) throw new Error("expected result");
    expect(res.fm.tags).toEqual(["a", "b", "c"]);
  });

  it("handles an empty frontmatter block", () => {
    const res = parseFrontmatter("---\n\n---\n");
    if (!res) throw new Error("expected result");
    expect(res.fm).toEqual({});
  });
});

describe("extractTitle", () => {
  it("returns the trimmed title field when present", () => {
    expect(extractTitle({ title: "  Spaced  " })).toBe("Spaced");
  });

  it("falls back to the name field", () => {
    expect(extractTitle({ name: "Named" })).toBe("Named");
  });

  it("prefers title over name", () => {
    expect(extractTitle({ title: "T", name: "N" })).toBe("T");
  });

  it("returns empty string when neither field is a non-empty string", () => {
    expect(extractTitle({})).toBe("");
    expect(extractTitle({ title: "   " })).toBe("");
    expect(extractTitle({ title: 42 })).toBe("");
  });
});
