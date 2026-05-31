// S-PSDK-002: 호스트 측 부트스트랩 회귀.

import { registerParser } from "@markspread/parser-sdk";
import { afterEach, describe, expect, it } from "vitest";
import { BUILTIN_MARKDOWN_ID, __resetParserRegistryForTests, getParserRegistry } from "../registry";

afterEach(() => __resetParserRegistryForTests());

describe("host parser registry bootstrap", () => {
  it("matches builtin markdown by extension for .md", () => {
    // builtin manifest 가 .md 등록. tie-break 가 최근 등록 우선이므로
    // 사용자가 custom .md 파서 등록하면 거기로 라우팅. 미등록 시 builtin
    // 매칭 (extension reason).
    const reg = getParserRegistry();
    const m = reg.match({ path: "/notes.md" });
    expect(m?.parser.manifest.id).toBe(BUILTIN_MARKDOWN_ID);
    expect(m?.reason).toBe("extension");
  });

  it("marks builtin markdown as a system parser (delete blocked)", () => {
    const reg = getParserRegistry();
    expect(reg.isSystem(BUILTIN_MARKDOWN_ID)).toBe(true);
    expect(reg.unregisterParser(BUILTIN_MARKDOWN_ID)).toBe(false);
    expect(reg.match({ path: "/x.md" })?.parser.manifest.id).toBe(BUILTIN_MARKDOWN_ID);
  });

  it("falls back to markdown for unknown extensions", () => {
    const reg = getParserRegistry();
    const m = reg.match({ path: "/journal.unknownext" });
    expect(m?.parser.manifest.id).toBe(BUILTIN_MARKDOWN_ID);
    expect(m?.reason).toBe("fallback");
  });

  it("delegates external registerParser() calls to the singleton", () => {
    const reg = getParserRegistry();
    registerParser(
      {
        id: "csv-demo",
        version: "0.1.0",
        displayName: "CSV Demo",
        fileMatch: { extensions: [".csv"] },
        capabilities: "preview-only",
        entry: "./e.js",
      },
      () => ({ ast: null }),
    );
    const m = reg.match({ path: "/data.csv" });
    expect(m?.parser.manifest.id).toBe("csv-demo");
  });

  it("returns the same singleton on repeated calls", () => {
    const a = getParserRegistry();
    const b = getParserRegistry();
    expect(a).toBe(b);
  });

  it("the builtin markdown factory passes the source through as a markdown AST", () => {
    const reg = getParserRegistry();
    const m = reg.match({ path: "/notes.md" });
    const parsed = m?.parser.factory({ path: "/notes.md", content: "# hi", encoding: "utf-8" });
    expect(parsed).toEqual({ ast: { kind: "markdown", source: "# hi" } });
  });
});
