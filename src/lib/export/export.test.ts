// Unit tests for the document export IPC wrappers.

import { beforeEach, describe, expect, it, vi } from "vitest";

const invokeMock = vi.fn();
vi.mock("@tauri-apps/api/core", () => ({
  invoke: (...args: unknown[]) => invokeMock(...args),
}));

import {
  BUILTIN_TEMPLATES,
  type BatchExportRequest,
  DEFAULT_PAGE_SETUP,
  type ExportRequest,
  exportBatch,
  exportDocument,
  printPreview,
} from "./export";

const template = BUILTIN_TEMPLATES[0];
if (!template) throw new Error("expected a builtin template");

const req: ExportRequest = {
  format: "pdf",
  documentPath: "/doc.md",
  bodyHtml: "<p>hi</p>",
  title: "Doc",
  template,
};

beforeEach(() => {
  invokeMock.mockReset();
});

describe("constants", () => {
  it("default page setup is A4 portrait with even margins", () => {
    expect(DEFAULT_PAGE_SETUP.size).toBe("A4");
    expect(DEFAULT_PAGE_SETUP.orientation).toBe("portrait");
    expect(DEFAULT_PAGE_SETUP.marginsIn.top).toBe(0.8);
  });

  it("ships four builtin templates with builtin css paths", () => {
    expect(BUILTIN_TEMPLATES).toHaveLength(4);
    for (const t of BUILTIN_TEMPLATES) {
      expect(t.cssPath.startsWith(":builtin:")).toBe(true);
    }
  });
});

describe("exportDocument", () => {
  it("invokes export_document and returns the result", async () => {
    const result = { ok: true, outputPath: "/out.pdf", bytesWritten: 100 };
    invokeMock.mockResolvedValue(result);
    expect(await exportDocument(req)).toEqual(result);
    expect(invokeMock).toHaveBeenCalledWith("export_document", { req });
  });

  it("propagates a failed export result", async () => {
    const result = { ok: false, error: { code: "E1001", message: "disk full" } };
    invokeMock.mockResolvedValue(result);
    expect(await exportDocument(req)).toEqual(result);
  });
});

describe("printPreview", () => {
  it("invokes export_print", async () => {
    invokeMock.mockResolvedValue(undefined);
    await printPreview();
    expect(invokeMock).toHaveBeenCalledWith("export_print");
  });
});

describe("exportBatch", () => {
  it("invokes export_batch and returns failures", async () => {
    const batchReq: BatchExportRequest = {
      format: "html",
      documents: [{ path: "/a.md", title: "A" }],
      outputDir: "/out",
      template,
    };
    invokeMock.mockResolvedValue({ failures: [] });
    expect(await exportBatch(batchReq)).toEqual({ failures: [] });
    expect(invokeMock).toHaveBeenCalledWith("export_batch", { req: batchReq });
  });
});
