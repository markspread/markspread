// S-AI-014: Translate sidecar path computation coverage.

import { describe, expect, it } from "vitest";
import { sidecarPath } from "../translate-sidecar";

describe("sidecarPath", () => {
  it("inserts the language tag before the extension", () => {
    expect(sidecarPath("/notes/README.md", "ko")).toBe("/notes/README.ko.md");
  });

  it("handles a bare filename with no directory", () => {
    expect(sidecarPath("README.md", "ja")).toBe("README.ja.md");
  });

  it("handles Windows-style backslash paths", () => {
    expect(sidecarPath("C:\\docs\\guide.md", "es")).toBe("C:\\docs\\guide.es.md");
  });

  it("strips an existing two-letter language tag when re-translating", () => {
    expect(sidecarPath("/notes/README.ko.md", "ja")).toBe("/notes/README.ja.md");
  });

  it("strips an existing region-qualified language tag", () => {
    expect(sidecarPath("/notes/README.pt-BR.md", "ko")).toBe("/notes/README.ko.md");
  });

  it("defaults to a .md extension when the file has none", () => {
    expect(sidecarPath("/notes/README", "ko")).toBe("/notes/README.ko.md");
  });
});
