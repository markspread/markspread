// S-AI-017 / S-AI-018: Rewrite prompt coverage.

import { describe, expect, it } from "vitest";
import { REWRITE_GUIDANCE, type RewriteTone, buildRewritePrompt } from "../rewrite";

describe("buildRewritePrompt", () => {
  it("passes the selection verbatim as the user message", () => {
    expect(buildRewritePrompt("my text", "formal").user).toBe("my text");
  });

  it("uses tone-specific guidance for formal", () => {
    const p = buildRewritePrompt("x", "formal");
    expect(p.system).toContain("formal register");
    expect(p.system).toContain("Output only the rewritten passage");
  });

  it("uses tone-specific guidance for casual", () => {
    expect(buildRewritePrompt("x", "casual").system).toContain("casual");
  });

  it("REWRITE_GUIDANCE covers both tones", () => {
    for (const tone of ["formal", "casual"] as RewriteTone[]) {
      expect(REWRITE_GUIDANCE[tone].length).toBeGreaterThan(0);
    }
  });
});
