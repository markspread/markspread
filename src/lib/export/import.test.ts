// Unit tests for the document import helpers.

import { beforeEach, describe, expect, it, vi } from "vitest";

const invokeMock = vi.fn();
vi.mock("@tauri-apps/api/core", () => ({
  invoke: (...args: unknown[]) => invokeMock(...args),
}));

import {
  IMPORT_FILTERS,
  type ImportRequest,
  PDF_IMPORT_CAVEATS,
  detectSourceByExtension,
  importDocument,
} from "./import";

beforeEach(() => {
  invokeMock.mockReset();
});

describe("importDocument", () => {
  it("invokes import_document and returns the result", async () => {
    const req: ImportRequest = {
      source: "docx",
      inputPath: "/in.docx",
      assetsDir: "/in.assets",
    };
    const result = { markdown: "# Hi", assets: [], warnings: [] };
    invokeMock.mockResolvedValue(result);
    expect(await importDocument(req)).toEqual(result);
    expect(invokeMock).toHaveBeenCalledWith("import_document", { req });
  });
});

describe("constants", () => {
  it("PDF caveats list is non-empty", () => {
    expect(PDF_IMPORT_CAVEATS.length).toBeGreaterThan(0);
  });

  it("import filters cover docx, html, and pdf", () => {
    expect(IMPORT_FILTERS.map((f) => f.source)).toEqual(["docx", "html", "pdf"]);
  });
});

describe("detectSourceByExtension", () => {
  it("detects each supported extension", () => {
    expect(detectSourceByExtension("/a/b.docx")).toBe("docx");
    expect(detectSourceByExtension("file.html")).toBe("html");
    expect(detectSourceByExtension("file.htm")).toBe("html");
    expect(detectSourceByExtension("file.pdf")).toBe("pdf");
  });

  it("is case-insensitive", () => {
    expect(detectSourceByExtension("REPORT.PDF")).toBe("pdf");
  });

  it("returns null for an unknown extension", () => {
    expect(detectSourceByExtension("notes.txt")).toBeNull();
  });

  it("returns null for a path with no extension", () => {
    expect(detectSourceByExtension("README")).toBe(null);
  });

  it("returns null for an empty trailing extension", () => {
    expect(detectSourceByExtension("trailingdot.")).toBeNull();
  });
});
