// ADR-0014 (T2.c): Code Viewer — success path of the lazy language loaders.
//
// The optional @codemirror/lang-* packages are not installed by default, so
// the bodies that return a real language Extension never run in a plain test
// environment. Here we mock each module so every loader takes its try branch
// and returns the (mocked) Extension, covering the `return mod.X(...)` lines
// of all 13 loaders. The failure/catch branch lives in code-viewer.test.ts.

import { describe, expect, it, vi } from "vitest";

vi.mock("@codemirror/lang-javascript", () => ({
  // record the opts each variant passes so we assert ts/jsx wiring too
  javascript: (opts?: { typescript?: boolean; jsx?: boolean }) => ({ lang: "javascript", opts }),
}));
vi.mock("@codemirror/lang-json", () => ({ json: () => ({ lang: "json" }) }));
vi.mock("@codemirror/lang-css", () => ({ css: () => ({ lang: "css" }) }));
vi.mock("@codemirror/lang-html", () => ({ html: () => ({ lang: "html" }) }));
vi.mock("@codemirror/lang-rust", () => ({ rust: () => ({ lang: "rust" }) }));
vi.mock("@codemirror/lang-python", () => ({ python: () => ({ lang: "python" }) }));
vi.mock("@codemirror/lang-go", () => ({ go: () => ({ lang: "go" }) }));
vi.mock("@codemirror/lang-sql", () => ({ sql: () => ({ lang: "sql" }) }));
vi.mock("@codemirror/lang-yaml", () => ({ yaml: () => ({ lang: "yaml" }) }));

import { getLanguageFor } from "../code-viewer";

describe("getLanguageFor — success path (mocked language modules)", () => {
  it("loads typescript with the typescript flag for .ts", async () => {
    expect(await getLanguageFor("a.ts")).toEqual({
      lang: "javascript",
      opts: { typescript: true },
    });
  });

  it("loads javascript with jsx + typescript for .tsx", async () => {
    expect(await getLanguageFor("a.tsx")).toEqual({
      lang: "javascript",
      opts: { jsx: true, typescript: true },
    });
  });

  it("loads plain javascript (no opts) for .js", async () => {
    expect(await getLanguageFor("a.js")).toEqual({ lang: "javascript", opts: undefined });
  });

  it("loads javascript with jsx for .jsx", async () => {
    expect(await getLanguageFor("a.jsx")).toEqual({ lang: "javascript", opts: { jsx: true } });
  });

  it.each([
    [".json", "json"],
    [".css", "css"],
    [".html", "html"],
    [".rs", "rust"],
    [".py", "python"],
    [".go", "go"],
    [".sql", "sql"],
    [".yaml", "yaml"],
    [".yml", "yaml"],
  ])("loads the %s module → %s", async (ext, lang) => {
    expect(await getLanguageFor(`file${ext}`)).toEqual({ lang });
  });
});
