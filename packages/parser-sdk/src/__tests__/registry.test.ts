// S-PSDK-002: ParserRegistry 우선순위 + 충돌 + fallback 회귀.

import { beforeEach, describe, expect, it } from "vitest";
import type { ParserManifest } from "../manifest";
import { ParserRegistry, globMatch } from "../registry";

const noopFactory = () => ({ ast: null });

function mf(over: Partial<ParserManifest> & Pick<ParserManifest, "id">): ParserManifest {
  return {
    id: over.id,
    version: "0.0.1",
    displayName: over.displayName ?? over.id,
    fileMatch: over.fileMatch ?? { extensions: [".x"] },
    capabilities: over.capabilities ?? "preview-only",
    entry: over.entry ?? "./e.js",
  };
}

describe("ParserRegistry — priority", () => {
  let reg: ParserRegistry;
  beforeEach(() => {
    reg = new ParserRegistry();
  });

  it("frontmatter sniff beats extension and glob", () => {
    reg.registerParser(mf({ id: "csv-ext", fileMatch: { extensions: [".csv"] } }), noopFactory);
    reg.registerParser(
      mf({ id: "diagram", fileMatch: { frontmatterSniff: { type: "diagram" } } }),
      noopFactory,
    );
    reg.registerParser(mf({ id: "any-csv", fileMatch: { globs: ["**/*.csv"] } }), noopFactory);
    const r = reg.match({ path: "/a/b.csv", frontmatter: { type: "diagram" } });
    expect(r?.parser.manifest.id).toBe("diagram");
    expect(r?.reason).toBe("frontmatter");
  });

  it("extension exact beats glob when both match", () => {
    reg.registerParser(mf({ id: "csv-ext", fileMatch: { extensions: [".csv"] } }), noopFactory);
    reg.registerParser(mf({ id: "glob-csv", fileMatch: { globs: ["**/*.csv"] } }), noopFactory);
    const r = reg.match({ path: "/a/b.csv" });
    expect(r?.parser.manifest.id).toBe("csv-ext");
    expect(r?.reason).toBe("extension");
  });

  it("more specific frontmatter sniff (more keys) wins over less specific", () => {
    reg.registerParser(
      mf({ id: "narrow", fileMatch: { frontmatterSniff: { type: "diagram", lang: "mermaid" } } }),
      noopFactory,
    );
    reg.registerParser(
      mf({ id: "wide", fileMatch: { frontmatterSniff: { type: "diagram" } } }),
      noopFactory,
    );
    const r = reg.match({
      path: "/x.md",
      frontmatter: { type: "diagram", lang: "mermaid" },
    });
    expect(r?.parser.manifest.id).toBe("narrow");
  });

  it("returns null when nothing matches and no fallback is set", () => {
    reg.registerParser(mf({ id: "csv", fileMatch: { extensions: [".csv"] } }), noopFactory);
    expect(reg.match({ path: "/x.md" })).toBeNull();
  });

  it("falls back when registered fallback exists and nothing else matches", () => {
    reg.registerParser(
      mf({ id: "md", fileMatch: { extensions: [".md"] }, capabilities: "preview-plus-edit" }),
      noopFactory,
    );
    reg.setFallback("md");
    const r = reg.match({ path: "/no-extension-here" });
    expect(r?.parser.manifest.id).toBe("md");
    expect(r?.reason).toBe("fallback");
  });

  it("does not use fallback when a real match exists", () => {
    reg.registerParser(mf({ id: "md", fileMatch: { extensions: [".md"] } }), noopFactory);
    reg.registerParser(mf({ id: "csv", fileMatch: { extensions: [".csv"] } }), noopFactory);
    reg.setFallback("md");
    const r = reg.match({ path: "/a.csv" });
    expect(r?.parser.manifest.id).toBe("csv");
    expect(r?.reason).toBe("extension");
  });
});

describe("ParserRegistry — conflicts and candidates", () => {
  let reg: ParserRegistry;
  beforeEach(() => {
    reg = new ParserRegistry();
  });

  it("returns same-score candidates with the most recently registered first", () => {
    // FIX: tie-break 정책 — 최근 등록된 파서 우선. 사용자가 chat 으로 만든
    // custom 파서가 시스템 builtin (먼저 등록됨) 을 항상 override 하도록.
    reg.registerParser(mf({ id: "first", fileMatch: { extensions: [".csv"] } }), noopFactory);
    reg.registerParser(mf({ id: "second", fileMatch: { extensions: [".csv"] } }), noopFactory);
    const cs = reg.candidates({ path: "/a.csv" });
    expect(cs.map((c) => c.parser.manifest.id)).toEqual(["second", "first"]);
  });

  it("candidates() returns all compatible parsers ranked", () => {
    reg.registerParser(mf({ id: "csv-ext", fileMatch: { extensions: [".csv"] } }), noopFactory);
    reg.registerParser(mf({ id: "csv-glob", fileMatch: { globs: ["**/*.csv"] } }), noopFactory);
    const cs = reg.candidates({ path: "/a.csv" });
    expect(cs.map((c) => c.parser.manifest.id)).toEqual(["csv-ext", "csv-glob"]);
    expect(cs[0]?.score).toBeGreaterThan(cs[1]?.score);
  });

  it("candidates() is empty for unsupported paths (no fallback)", () => {
    reg.registerParser(mf({ id: "csv", fileMatch: { extensions: [".csv"] } }), noopFactory);
    expect(reg.candidates({ path: "/x.unknown" })).toEqual([]);
  });
});

describe("ParserRegistry — lifecycle", () => {
  it("throws on duplicate id", () => {
    const reg = new ParserRegistry();
    reg.registerParser(mf({ id: "x" }), noopFactory);
    expect(() => reg.registerParser(mf({ id: "x" }), noopFactory)).toThrow(/already registered/);
  });

  it("unregisterParser removes the parser and its renderer", () => {
    const reg = new ParserRegistry();
    reg.registerParser(mf({ id: "x", fileMatch: { extensions: [".x"] } }), noopFactory);
    reg.registerRenderer({ kind: "html", parserId: "x", render: () => "" });
    expect(reg.getRenderer("x")).toBeDefined();
    expect(reg.unregisterParser("x")).toBe(true);
    expect(reg.getRenderer("x")).toBeUndefined();
    expect(reg.match({ path: "/a.x" })).toBeNull();
  });

  it("clears fallback if the fallback parser is unregistered", () => {
    const reg = new ParserRegistry();
    reg.registerParser(mf({ id: "md", fileMatch: { extensions: [".md"] } }), noopFactory);
    reg.setFallback("md");
    reg.unregisterParser("md");
    expect(reg.match({ path: "/x" })).toBeNull();
  });

  it("registerRenderer rejects unknown parserId", () => {
    const reg = new ParserRegistry();
    expect(() =>
      reg.registerRenderer({ kind: "html", parserId: "missing", render: () => "" }),
    ).toThrow(/unknown parser/);
  });

  it("setFallback rejects unknown id", () => {
    const reg = new ParserRegistry();
    expect(() => reg.setFallback("nope")).toThrow(/unknown parser/);
  });

  it("markSystem throws for unknown parser ids", () => {
    const reg = new ParserRegistry();
    expect(() => reg.markSystem("ghost")).toThrow(/Cannot mark unknown parser 'ghost' as system/);
  });

  it("markSystem locks a parser so it is reported as system and cannot be unregistered", () => {
    const reg = new ParserRegistry();
    reg.registerParser(mf({ id: "md", fileMatch: { extensions: [".md"] } }), noopFactory);
    expect(reg.isSystem("md")).toBe(false);
    reg.markSystem("md");
    expect(reg.isSystem("md")).toBe(true);
    expect(reg.unregisterParser("md")).toBe(false);
    // still present
    expect(reg.list().map((p) => p.manifest.id)).toEqual(["md"]);
  });

  it("list() returns every registered parser in insertion order", () => {
    const reg = new ParserRegistry();
    reg.registerParser(mf({ id: "a" }), noopFactory);
    reg.registerParser(mf({ id: "b" }), noopFactory);
    expect(reg.list().map((p) => p.manifest.id)).toEqual(["a", "b"]);
  });

  it("returns null when a parser declares only globs but none match", () => {
    const reg = new ParserRegistry();
    reg.registerParser(mf({ id: "globby", fileMatch: { globs: ["docs/*.md"] } }), noopFactory);
    expect(reg.match({ path: "/elsewhere/file.md" })).toBeNull();
  });
});

describe("globMatch", () => {
  it("matches simple star within a single segment", () => {
    expect(globMatch("docs/*.md", "docs/intro.md")).toBe(true);
    expect(globMatch("docs/*.md", "docs/sub/intro.md")).toBe(false);
  });

  it("matches double-star across segments", () => {
    expect(globMatch("docs/**/*.md", "docs/a/b/c.md")).toBe(true);
    expect(globMatch("**/*.csv", "/a/b.csv")).toBe(true);
  });

  it("matches single-char wildcard", () => {
    expect(globMatch("a?.md", "ab.md")).toBe(true);
    expect(globMatch("a?.md", "abc.md")).toBe(false);
  });

  it("escapes regex meta characters in literal positions", () => {
    expect(globMatch("a.b+c", "a.b+c")).toBe(true);
    expect(globMatch("a.b+c", "axb+c")).toBe(false);
  });
});
