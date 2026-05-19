// S-AI-019..024: prompt scaffold coverage.

import { describe, expect, it } from "vitest";
import {
  buildBrainstormPrompt,
  buildContinuePrompt,
  buildFactCheckPrompt,
  buildFormatPrompt,
  buildOutlinePrompt,
  buildTitlePrompt,
} from "../prompts";

describe("buildContinuePrompt", () => {
  it("returns a system + user pair", () => {
    const p = buildContinuePrompt("some preceding text");
    expect(p.system).toContain("continue prose");
    expect(p.user).toBe("some preceding text");
  });

  it("caps the preceding tail at 4000 chars", () => {
    const p = buildContinuePrompt("z".repeat(5000));
    expect(p.user).toHaveLength(4000);
  });
});

describe("buildBrainstormPrompt", () => {
  it("trims the topic", () => {
    expect(buildBrainstormPrompt("  ideas  ").user).toBe("ideas");
  });

  it("falls back to a default when topic is blank", () => {
    expect(buildBrainstormPrompt("   ").user).toContain("Brainstorm angles");
  });
});

describe("buildOutlinePrompt", () => {
  it("passes the document verbatim", () => {
    const p = buildOutlinePrompt("# doc");
    expect(p.user).toBe("# doc");
    expect(p.system).toContain("outline");
  });
});

describe("buildTitlePrompt", () => {
  it("caps the document at 6000 chars", () => {
    const p = buildTitlePrompt("a".repeat(7000));
    expect(p.user).toHaveLength(6000);
  });
});

describe("buildFactCheckPrompt", () => {
  it("returns a claim-status-source scaffold", () => {
    const p = buildFactCheckPrompt("the claim");
    expect(p.system).toContain("CLAIM:");
    expect(p.user).toBe("the claim");
  });
});

describe("buildFormatPrompt", () => {
  it("returns canonical markdown guidance", () => {
    const p = buildFormatPrompt("md");
    expect(p.system).toContain("CommonMark");
    expect(p.user).toBe("md");
  });
});
