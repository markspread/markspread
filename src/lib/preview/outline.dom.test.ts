// Coverage for the Outline tab data model.

import { describe, expect, it } from "vitest";
import {
  type Heading,
  extractHeadings,
  filterHeadings,
  findActiveHeading,
  slugify,
} from "./outline";

describe("extractHeadings", () => {
  it("extracts ATX headings with depth and 1-based line", () => {
    const hs = extractHeadings("# One\n\n## Two\n\n### Three");
    expect(hs).toHaveLength(3);
    expect(hs[0]).toMatchObject({ text: "One", depth: 1, line: 1 });
    expect(hs[1]).toMatchObject({ text: "Two", depth: 2, line: 3 });
    expect(hs[2]).toMatchObject({ text: "Three", depth: 3, line: 5 });
  });

  it("strips trailing hashes from ATX headings", () => {
    const hs = extractHeadings("## Closed ##");
    expect(hs[0]?.text).toBe("Closed");
  });

  it("extracts setext headings (= → depth 1, - → depth 2)", () => {
    const hs = extractHeadings("Title\n=====\n\nSub\n-----");
    expect(hs[0]).toMatchObject({ text: "Title", depth: 1, line: 1 });
    expect(hs[1]).toMatchObject({ text: "Sub", depth: 2, line: 4 });
  });

  it("ignores headings inside fenced code blocks", () => {
    const md = "# Real\n\n```\n# Not a heading\n```\n\n## After";
    const hs = extractHeadings(md);
    expect(hs.map((h) => h.text)).toEqual(["Real", "After"]);
  });

  it("handles tilde fences", () => {
    const md = "~~~\n# fake\n~~~\n# real";
    const hs = extractHeadings(md);
    expect(hs.map((h) => h.text)).toEqual(["real"]);
  });

  it("does not treat a setext underline after a blank line as a heading", () => {
    const hs = extractHeadings("\n-----");
    expect(hs).toEqual([]);
  });

  it("returns an empty array for plain prose", () => {
    expect(extractHeadings("just text\nmore text")).toEqual([]);
  });

  it("attaches GitHub-style slugs", () => {
    const hs = extractHeadings("# Hello World!");
    expect(hs[0]?.slug).toBe("hello-world");
  });
});

describe("findActiveHeading", () => {
  const headings: Heading[] = [
    { text: "A", depth: 1, line: 1, slug: "a" },
    { text: "B", depth: 1, line: 10, slug: "b" },
    { text: "C", depth: 1, line: 20, slug: "c" },
  ];

  it("returns the most recent heading at or above the cursor", () => {
    expect(findActiveHeading(headings, 15)?.text).toBe("B");
  });

  it("returns the heading on the exact cursor line", () => {
    expect(findActiveHeading(headings, 10)?.text).toBe("B");
  });

  it("returns null when the cursor is above every heading", () => {
    expect(findActiveHeading(headings, 0)).toBeNull();
  });

  it("returns the last heading when the cursor is past all of them", () => {
    expect(findActiveHeading(headings, 999)?.text).toBe("C");
  });
});

describe("filterHeadings", () => {
  const headings: Heading[] = [
    { text: "Install", depth: 1, line: 1, slug: "install" },
    { text: "Usage", depth: 1, line: 5, slug: "usage" },
  ];

  it("returns all headings for an empty/whitespace query", () => {
    expect(filterHeadings(headings, "")).toBe(headings);
    expect(filterHeadings(headings, "   ")).toBe(headings);
  });

  it("filters case-insensitively by substring", () => {
    expect(filterHeadings(headings, "USA").map((h) => h.text)).toEqual(["Usage"]);
  });

  it("returns an empty array when nothing matches", () => {
    expect(filterHeadings(headings, "zzz")).toEqual([]);
  });
});

describe("slugify", () => {
  it("lowercases and hyphenates", () => {
    expect(slugify("My Section Title")).toBe("my-section-title");
  });

  it("drops punctuation", () => {
    expect(slugify("Hello, World!")).toBe("hello-world");
  });

  it("collapses consecutive hyphens", () => {
    expect(slugify("a  -  b")).toBe("a-b");
  });

  it("trims leading and trailing hyphens", () => {
    expect(slugify("-edge-")).toBe("edge");
  });

  it("keeps unicode letters and numbers", () => {
    expect(slugify("버전 2")).toBe("버전-2");
  });
});
