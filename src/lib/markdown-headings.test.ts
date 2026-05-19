// S-A11-011: heading-structure validation + scan.

import { describe, expect, it } from "vitest";
import { type ParsedHeading, scanHeadings, validateHeadings } from "./markdown-headings";

const h = (level: ParsedHeading["level"], line: number, text = "x"): ParsedHeading => ({
  level,
  text,
  line,
});

describe("validateHeadings", () => {
  it("reports no violations for a well-formed outline", () => {
    expect(validateHeadings([h(1, 1), h(2, 2), h(3, 3), h(2, 4)])).toEqual([]);
  });

  it("flags a skipped level", () => {
    const v = validateHeadings([h(1, 1), h(3, 5)]);
    expect(v).toHaveLength(1);
    expect(v[0]?.kind).toBe("skipped-level");
    expect(v[0]?.message).toContain("h1 to h3");
    expect(v[0]?.heading.line).toBe(5);
  });

  it("flags multiple h1", () => {
    const v = validateHeadings([h(1, 1), h(1, 10)]);
    expect(v).toHaveLength(1);
    expect(v[0]?.kind).toBe("multiple-h1");
    expect(v[0]?.message).toContain("line 10");
  });

  it("reports both violations when present", () => {
    const v = validateHeadings([h(1, 1), h(1, 2), h(4, 3)]);
    expect(v.map((x) => x.kind)).toEqual(["multiple-h1", "skipped-level"]);
  });

  it("allows going deeper by exactly one level", () => {
    expect(validateHeadings([h(2, 1), h(3, 2)])).toEqual([]);
  });

  it("allows jumping back up multiple levels", () => {
    expect(validateHeadings([h(2, 1), h(3, 2), h(4, 3), h(2, 4)])).toEqual([]);
  });

  it("does not flag the first heading even when deep", () => {
    expect(validateHeadings([h(3, 1)])).toEqual([]);
  });
});

describe("scanHeadings", () => {
  it("parses ATX headings with their levels", () => {
    const out = scanHeadings("# One\n\n## Two\n\n### Three");
    expect(out).toEqual([
      { level: 1, text: "One", line: 1 },
      { level: 2, text: "Two", line: 3 },
      { level: 3, text: "Three", line: 5 },
    ]);
  });

  it("trims trailing closing hashes", () => {
    const out = scanHeadings("# Heading #");
    expect(out[0]?.text).toBe("Heading");
  });

  it("parses setext headings", () => {
    const out = scanHeadings("Title\n=====\n\nSub\n-----");
    expect(out).toEqual([
      { level: 1, text: "Title", line: 1 },
      { level: 2, text: "Sub", line: 4 },
    ]);
  });

  it("ignores headings inside fenced code blocks", () => {
    const out = scanHeadings("# Real\n```\n# Fake\n```\n## After");
    expect(out.map((x) => x.text)).toEqual(["Real", "After"]);
  });

  it("handles tilde fences", () => {
    const out = scanHeadings("~~~\n# Fake\n~~~\n# Real");
    expect(out.map((x) => x.text)).toEqual(["Real"]);
  });

  it("handles CRLF line endings", () => {
    const out = scanHeadings("# One\r\n## Two");
    expect(out).toHaveLength(2);
  });

  it("returns empty for content with no headings", () => {
    expect(scanHeadings("just text\nmore text")).toEqual([]);
  });

  it("does not treat a setext underline without content as a heading", () => {
    expect(scanHeadings("\n=====")).toEqual([]);
  });
});
