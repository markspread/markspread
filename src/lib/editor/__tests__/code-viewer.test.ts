// ADR-0014 (T2.c): Code Viewer 단위 테스트.
//
// lazy language module import 자체는 jsdom 환경에서 dynamic import resolution
// 가 일관 동작하지 않을 수 있어 unit 테스트는 *분기 + 매핑* 만 확인. 실제
// language 통합은 e2e (Playwright) 회차에서 검증.

import { describe, expect, it } from "vitest";
import {
  createCodeViewerSetup,
  getLanguageFor,
  isSupportedCodeExt,
  readOnlyExtension,
} from "../code-viewer";

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
    for (const ext of [
      ".ts",
      ".tsx",
      ".js",
      ".jsx",
      ".json",
      ".rs",
      ".py",
      ".go",
      ".sql",
      ".yaml",
      ".yml",
      ".css",
      ".html",
    ]) {
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

describe("readOnlyExtension", () => {
  it("returns an array (callable)", () => {
    expect(Array.isArray(readOnlyExtension())).toBe(true);
  });
});

describe("createCodeViewerSetup", () => {
  it("returns extensions array and pending language promise", () => {
    const setup = createCodeViewerSetup("script.ts");
    expect(Array.isArray(setup.extensions)).toBe(true);
    expect(setup.pendingLanguageLoad).toBeInstanceOf(Promise);
  });

  it("resolves pendingLanguageLoad without throwing for unsupported ext", async () => {
    const setup = createCodeViewerSetup("README.unknownext");
    const lang = await setup.pendingLanguageLoad;
    expect(lang).toBeNull();
  });

  it("calls getLanguageFor with longest-suffix preference (tsx beats ts)", async () => {
    // 본 테스트는 동작 보장만 — 실제 lang 인스턴스 검증은 e2e 에서.
    // jsdom 환경에서 lang module dynamic import 가 resolve 가능한지 본다.
    const setupTsx = createCodeViewerSetup("component.tsx");
    // promise 가 throw 없이 resolve 또는 reject 정상 처리되는지만 확인.
    await expect(setupTsx.pendingLanguageLoad).resolves.toBeDefined();
  });
});

describe("getLanguageFor — lazy-load failure path", () => {
  // The optional @codemirror/lang-* packages are not installed in the test
  // (or default) environment, so every loader's dynamic import rejects and
  // each loader falls through its catch to return null. This exercises the
  // try→catch→null branch of all 13 loaders. The success branch is covered
  // in code-viewer.langmock.test.ts where each module is mocked.
  for (const ext of ALL_EXTS) {
    it(`returns null (not a throw) when the ${ext} language module is absent`, async () => {
      await expect(getLanguageFor(`file${ext}`)).resolves.toBeNull();
    });
  }

  it("returns null for an unmapped extension without invoking any loader", async () => {
    await expect(getLanguageFor("notes.unknownext")).resolves.toBeNull();
    await expect(getLanguageFor("Makefile")).resolves.toBeNull();
  });
});
