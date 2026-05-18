// S-PSDK-002: 호스트 측 부트스트랩 회귀.

import { registerParser } from "@markspread/parser-sdk";
import { afterEach, describe, expect, it } from "vitest";
import { BUILTIN_MARKDOWN_ID, __resetParserRegistryForTests, getParserRegistry } from "../registry";

afterEach(() => __resetParserRegistryForTests());

describe("host parser registry bootstrap", () => {
  it("registers builtin markdown as a fallback parser", () => {
    const reg = getParserRegistry();
    const m = reg.match({ path: "/notes.md" });
    expect(m?.parser.manifest.id).toBe(BUILTIN_MARKDOWN_ID);
    expect(m?.reason).toBe("extension");
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
});
