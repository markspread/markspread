// S-AI-015 / S-AI-016: Summarize prompt coverage.

import { describe, expect, it } from "vitest";
import {
  SUMMARY_INSTRUCTION,
  SUMMARY_LABEL,
  type SummaryLength,
  buildSummarizePrompt,
} from "../summarize";

describe("buildSummarizePrompt", () => {
  it("embeds the document inside fenced delimiters", () => {
    const p = buildSummarizePrompt("the doc", "short");
    expect(p.user).toContain("the doc");
    expect(p.user).toContain("---");
  });

  it("uses the length-specific instruction", () => {
    for (const len of ["short", "medium", "long"] as SummaryLength[]) {
      const p = buildSummarizePrompt("d", len);
      expect(p.user.startsWith(SUMMARY_INSTRUCTION[len])).toBe(true);
    }
  });

  it("returns a stable system prompt", () => {
    expect(buildSummarizePrompt("d", "medium").system).toContain("careful editor");
  });
});

describe("SUMMARY_LABEL", () => {
  it("exposes an i18n key for each length", () => {
    expect(SUMMARY_LABEL.short).toBe("ai.summarize.length.short");
    expect(SUMMARY_LABEL.medium).toContain("medium");
    expect(SUMMARY_LABEL.long).toContain("long");
  });
});
