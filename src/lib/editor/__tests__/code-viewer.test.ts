// ADR-0014 (T2.c): Code Viewer 단위 테스트 — 매핑 + *로드 실패* 폴백.
//
// 각 @codemirror/lang-* 모듈을 throw 하는 factory 로 mock 해 dynamic import
// 실패를 시뮬레이트 — 모든 loader 가 try→catch→null 로 떨어져 plain text
// 폴백이 유지되는지 고정한다. 성공 경로는 code-viewer.langmock.test.ts
// (mocked module) + code-viewer.dom.test.ts (실제 module + EditorView) 담당.

import type { EditorView } from "@codemirror/view";
import { describe, expect, it, vi } from "vitest";
import { createCodeViewerSetup, getLanguageFor, isSupportedCodeExt } from "../code-viewer";

vi.mock("@codemirror/lang-javascript", () => {
  throw new Error("chunk load failed");
});
vi.mock("@codemirror/lang-json", () => {
  throw new Error("chunk load failed");
});
vi.mock("@codemirror/lang-css", () => {
  throw new Error("chunk load failed");
});
vi.mock("@codemirror/lang-html", () => {
  throw new Error("chunk load failed");
});
vi.mock("@codemirror/lang-rust", () => {
  throw new Error("chunk load failed");
});
vi.mock("@codemirror/lang-python", () => {
  throw new Error("chunk load failed");
});
vi.mock("@codemirror/lang-go", () => {
  throw new Error("chunk load failed");
});
vi.mock("@codemirror/lang-sql", () => {
  throw new Error("chunk load failed");
});
vi.mock("@codemirror/lang-yaml", () => {
  throw new Error("chunk load failed");
});

const ALL_EXTS = [
  ".ts",
  ".tsx",
  ".js",
  ".jsx",
  ".json",
  ".css",
  ".html",
  ".rs",
  ".py",
  ".go",
  ".sql",
  ".yaml",
  ".yml",
];

describe("isSupportedCodeExt", () => {
  it("returns true for supported extensions", () => {
    for (const ext of ALL_EXTS) {
      expect(isSupportedCodeExt(`file${ext}`)).toBe(true);
    }
  });

  it("returns false for unsupported", () => {
    expect(isSupportedCodeExt("file.unknown")).toBe(false);
    expect(isSupportedCodeExt("file.lock")).toBe(false);
    expect(isSupportedCodeExt("file")).toBe(false);
  });

  it("case-insensitive", () => {
    expect(isSupportedCodeExt("FILE.TS")).toBe(true);
    expect(isSupportedCodeExt("File.Json")).toBe(true);
  });
});

describe("getLanguageFor — lazy-load failure path", () => {
  // Every mocked module factory throws, so each loader's dynamic import
  // rejects and falls through its catch to return null. This exercises the
  // try→catch→null branch of all 13 loaders. The success branch is covered
  // in code-viewer.langmock.test.ts where each module is mocked.
  for (const ext of ALL_EXTS) {
    it(`returns null (not a throw) when the ${ext} language module fails to load`, async () => {
      await expect(getLanguageFor(`file${ext}`)).resolves.toBeNull();
    });
  }

  it("returns null for an unmapped extension without invoking any loader", async () => {
    await expect(getLanguageFor("notes.unknownext")).resolves.toBeNull();
    await expect(getLanguageFor("Makefile")).resolves.toBeNull();
  });
});

describe("createCodeViewerSetup — plain fallback", () => {
  it("mounts an (initially empty) language slot extension", () => {
    const setup = createCodeViewerSetup("script.ts");
    expect(setup.extensions).toHaveLength(1);
  });

  it("applyLanguage resolves false and never dispatches when the load fails", async () => {
    const dispatch = vi.fn();
    const view = { dispatch } as unknown as EditorView;
    const setup = createCodeViewerSetup("script.ts");
    await expect(setup.applyLanguage(view)).resolves.toBe(false);
    expect(dispatch).not.toHaveBeenCalled();
  });

  it("applyLanguage resolves false and never dispatches for an unmapped extension", async () => {
    const dispatch = vi.fn();
    const view = { dispatch } as unknown as EditorView;
    const setup = createCodeViewerSetup("README.unknownext");
    await expect(setup.applyLanguage(view, () => false)).resolves.toBe(false);
    expect(dispatch).not.toHaveBeenCalled();
  });
});
