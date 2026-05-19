// S-EP-010: file classification by extension.

import { describe, expect, it } from "vitest";
import { classifyFile, isMarkdownPath } from "./file-kind";

describe("classifyFile", () => {
  it("classifies known image extensions", () => {
    for (const ext of ["png", "jpg", "jpeg", "gif", "webp", "bmp", "ico", "svg", "avif"]) {
      expect(classifyFile(`/a/b/photo.${ext}`)).toBe("image");
    }
  });

  it("classifies pdf", () => {
    expect(classifyFile("/docs/report.pdf")).toBe("pdf");
    expect(classifyFile("REPORT.PDF")).toBe("pdf");
  });

  it("classifies binary extensions", () => {
    for (const ext of ["zip", "exe", "ttf", "mp3", "mp4", "psd", "docx", "sqlite", "jar"]) {
      expect(classifyFile(`file.${ext}`)).toBe("binary");
    }
  });

  it("treats unknown extensions as text", () => {
    expect(classifyFile("/etc/app.cfg")).toBe("text");
    expect(classifyFile("notes.log")).toBe("text");
    expect(classifyFile("script.ts")).toBe("text");
  });

  it("treats extensionless files as text", () => {
    expect(classifyFile("/usr/bin/README")).toBe("text");
    expect(classifyFile("Makefile")).toBe("text");
  });

  it("handles windows-style separators", () => {
    expect(classifyFile("C:\\images\\pic.png")).toBe("image");
  });

  it("ignores dots in directory names", () => {
    expect(classifyFile("/a.dir/subdir/plain")).toBe("text");
  });

  it("is case-insensitive on extension", () => {
    expect(classifyFile("ARCHIVE.ZIP")).toBe("binary");
  });
});

describe("isMarkdownPath", () => {
  it("recognises markdown extensions", () => {
    for (const ext of ["md", "markdown", "mdown", "mkd", "mdx", "mdc"]) {
      expect(isMarkdownPath(`/notes/doc.${ext}`)).toBe(true);
    }
  });

  it("is case-insensitive", () => {
    expect(isMarkdownPath("README.MD")).toBe(true);
  });

  it("rejects non-markdown extensions", () => {
    expect(isMarkdownPath("script.ts")).toBe(false);
    expect(isMarkdownPath("data.json")).toBe(false);
  });

  it("rejects extensionless files", () => {
    expect(isMarkdownPath("LICENSE")).toBe(false);
  });

  it("handles windows separators", () => {
    expect(isMarkdownPath("C:\\notes\\readme.md")).toBe(true);
  });

  it("ignores dots in directory names", () => {
    expect(isMarkdownPath("/a.md.dir/plainfile")).toBe(false);
  });
});
