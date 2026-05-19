// S-AI-004..008: Review apply/remap pure-logic coverage.

import { describe, expect, it } from "vitest";
import { type ReviewComment, applyComments, remapComments } from "../review";

function comment(over: Partial<ReviewComment>): ReviewComment {
  return {
    id: "c0",
    anchorLine: 1,
    message: "fix this",
    status: "pending",
    ...over,
  };
}

describe("applyComments", () => {
  const doc = "line1\nline2\nline3";

  it("leaves the document untouched when there are no suggestions", () => {
    const { doc: out, result } = applyComments(doc, [comment({})]);
    expect(out).toBe(doc);
    expect(result.applied).toHaveLength(0);
  });

  it("applies a single-line suggestion", () => {
    const { doc: out, result } = applyComments(doc, [
      comment({ anchorLine: 2, suggestion: { text: "REPLACED", anchorEndLine: 2 } }),
    ]);
    expect(out).toBe("line1\nREPLACED\nline3");
    expect(result.applied).toHaveLength(1);
    expect(result.applied[0]?.status).toBe("applied");
  });

  it("applies a multi-line suggestion replacing a range", () => {
    const { doc: out } = applyComments(doc, [
      comment({ anchorLine: 1, suggestion: { text: "A\nB", anchorEndLine: 2 } }),
    ]);
    expect(out).toBe("A\nB\nline3");
  });

  it("skips a suggestion with an out-of-range line as stale", () => {
    const { result } = applyComments(doc, [
      comment({ anchorLine: 1, suggestion: { text: "x", anchorEndLine: 99 } }),
    ]);
    expect(result.skipped[0]?.reason).toBe("stale");
  });

  it("skips a suggestion with start > end as stale", () => {
    const { result } = applyComments(doc, [
      comment({ anchorLine: 3, suggestion: { text: "x", anchorEndLine: 1 } }),
    ]);
    expect(result.skipped[0]?.reason).toBe("stale");
  });

  it("reports overlapping suggestions as a conflict", () => {
    // Comments are applied bottom-up, so the higher anchorLine claims its
    // lines first; the overlapping lower-anchor comment loses.
    const { result } = applyComments(doc, [
      comment({ id: "low", anchorLine: 1, suggestion: { text: "A", anchorEndLine: 2 } }),
      comment({ id: "high", anchorLine: 2, suggestion: { text: "B", anchorEndLine: 2 } }),
    ]);
    expect(result.applied).toHaveLength(1);
    expect(result.applied[0]?.id).toBe("high");
    expect(result.skipped[0]?.reason).toBe("conflict");
    expect(result.skipped[0]?.comment.id).toBe("low");
  });

  it("ignores non-pending comments", () => {
    const { result } = applyComments(doc, [
      comment({ status: "dismissed", suggestion: { text: "x", anchorEndLine: 1 } }),
    ]);
    expect(result.applied).toHaveLength(0);
    expect(result.skipped).toHaveLength(0);
  });
});

describe("remapComments", () => {
  it("leaves non-pending comments untouched", () => {
    const c = comment({ status: "applied", anchorLine: 5 });
    const [out] = remapComments([c], () => null);
    expect(out).toBe(c);
  });

  it("re-anchors a pending comment when the line still exists", () => {
    const [out] = remapComments([comment({ anchorLine: 3 })], (l) => l + 10);
    expect(out?.anchorLine).toBe(13);
  });

  it("marks a comment stale when its anchor line was removed", () => {
    const [out] = remapComments([comment({ anchorLine: 3 })], () => null);
    expect(out?.status).toBe("stale");
  });

  it("marks a comment stale when the suggestion end line was removed", () => {
    const c = comment({ anchorLine: 1, suggestion: { text: "x", anchorEndLine: 5 } });
    const [out] = remapComments([c], (l) => (l === 5 ? null : l));
    expect(out?.status).toBe("stale");
  });

  it("remaps both anchor and suggestion end line", () => {
    const c = comment({ anchorLine: 2, suggestion: { text: "x", anchorEndLine: 4 } });
    const [out] = remapComments([c], (l) => l * 2);
    expect(out?.anchorLine).toBe(4);
    expect(out?.suggestion?.anchorEndLine).toBe(8);
  });
});
