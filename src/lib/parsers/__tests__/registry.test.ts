// S-PSDK-002: 호스트 측 부트스트랩 회귀.

import { registerParser } from "@markspread/parser-sdk";
import { afterEach, describe, expect, it } from "vitest";
import {
  BUILTIN_MARKDOWN_ID,
  STUDIO_PREVIEW_PARSER_ID,
  __resetParserRegistryForTests,
  countUserParsers,
  getParserRegistry,
} from "../registry";

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

  // F1 회귀 고정: 동일 확장자 (.md) 를 builtin 과 custom 이 동시에 등록했을 때의
  // 우선순위 계약. 기존 .csv 테스트는 builtin 과 확장자가 겹치지 않아 tie-break
  // 를 간접적으로만 커버했다 — 여기서 직접 고정한다.
  it("routes .md to a custom parser registered over the builtin (recency tie-break)", () => {
    const reg = getParserRegistry();
    registerParser(
      {
        id: "md-custom",
        version: "0.1.0",
        displayName: "Custom Markdown",
        fileMatch: { extensions: [".md"] },
        capabilities: "preview-only",
        entry: "./e.js",
      },
      () => ({ ast: null }),
    );
    const m = reg.match({ path: "/notes.md" });
    expect(m?.parser.manifest.id).toBe("md-custom");
    // 동점 (score 100) 을 최근 등록으로 깬 것 — extension 매칭이지 fallback 이 아니다.
    expect(m?.reason).toBe("extension");
  });

  it("restores builtin markdown by extension match (not fallback) after the custom parser is unregistered", () => {
    const reg = getParserRegistry();
    registerParser(
      {
        id: "md-custom",
        version: "0.1.0",
        displayName: "Custom Markdown",
        fileMatch: { extensions: [".md"] },
        capabilities: "preview-only",
        entry: "./e.js",
      },
      () => ({ ast: null }),
    );
    expect(reg.match({ path: "/notes.md" })?.parser.manifest.id).toBe("md-custom");
    expect(reg.unregisterParser("md-custom")).toBe(true);
    const m = reg.match({ path: "/notes.md" });
    expect(m?.parser.manifest.id).toBe(BUILTIN_MARKDOWN_ID);
    expect(m?.reason).toBe("extension");
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

describe("countUserParsers (ADR-0019 T5 rail gate signal)", () => {
  const demoManifest = (id: string, ext: string) => ({
    id,
    version: "0.1.0",
    displayName: id,
    fileMatch: { extensions: [ext] },
    capabilities: "preview-only" as const,
    entry: "./e.js",
  });

  it("is zero on a fresh registry (only the system markdown parser exists)", () => {
    getParserRegistry();
    expect(countUserParsers()).toBe(0);
  });

  it("counts a self-authored parser but excludes the system markdown parser", () => {
    getParserRegistry();
    registerParser(demoManifest("wiki", ".wiki"), () => ({ ast: null }));
    expect(countUserParsers()).toBe(1);
  });

  it("excludes the Parser Studio temporary preview parser from the count", () => {
    getParserRegistry();
    registerParser(demoManifest(STUDIO_PREVIEW_PARSER_ID, ".__studiopreview__"), () => ({
      ast: null,
    }));
    expect(countUserParsers()).toBe(0);
    // a real user parser alongside the preview parser still counts as exactly one.
    registerParser(demoManifest("wiki", ".wiki"), () => ({ ast: null }));
    expect(countUserParsers()).toBe(1);
  });

  it("drops back to zero after the user parser is unregistered", () => {
    const reg = getParserRegistry();
    registerParser(demoManifest("wiki", ".wiki"), () => ({ ast: null }));
    expect(countUserParsers()).toBe(1);
    reg.unregisterParser("wiki");
    expect(countUserParsers()).toBe(0);
  });
});
