// ADR-0014 + H13: 드래그-채팅 편집 logic 테스트.

import { describe, expect, it } from "vitest";
import {
  applyDecision,
  buildSelectionContext,
  computeInlineDiff,
  makeChatPrompt,
} from "../drag-chat-edit";

describe("buildSelectionContext", () => {
  const sample = "line1\nline2 SELECTED\nline3\nline4";

  it("captures selected text + line/col offsets", () => {
    // SELECTED 의 offset: "line1\nline2 ".length = 12, end = 12 + 8 = 20
    const ctx = buildSelectionContext({
      filePath: "/ws/doc.md",
      fullText: sample,
      fromOffset: 12,
      toOffset: 20,
    });
    expect(ctx.filePath).toBe("/ws/doc.md");
    expect(ctx.selectedText).toBe("SELECTED");
    expect(ctx.from).toEqual({ line: 2, col: 7 });
    expect(ctx.to).toEqual({ line: 2, col: 15 });
  });

  it("captures surrounding context (default 5 lines)", () => {
    const big = Array.from({ length: 20 }, (_, i) => `line${i + 1}`).join("\n");
    // line10 의 시작 offset = sum("line1\n"..."line9\n")
    const lines = big.split("\n");
    let off = 0;
    for (let i = 0; i < 9; i += 1) off += (lines[i] ?? "").length + 1; // +1 for newline
    const ctx = buildSelectionContext({
      filePath: "/ws/x.md",
      fullText: big,
      fromOffset: off,
      toOffset: off + "line10".length,
      surroundingLines: 2,
    });
    expect(ctx.selectedText).toBe("line10");
    expect(ctx.surroundingContext?.before.split("\n")).toEqual(["line8", "line9"]);
    expect(ctx.surroundingContext?.after.split("\n")).toEqual(["line11", "line12"]);
  });
});

describe("makeChatPrompt", () => {
  it("wires prompt + selection together", () => {
    const sel = buildSelectionContext({
      filePath: "/x.md",
      fullText: "abc",
      fromOffset: 0,
      toOffset: 3,
    });
    const p = makeChatPrompt("smoother please", sel);
    expect(p.userPrompt).toBe("smoother please");
    expect(p.selection.selectedText).toBe("abc");
  });
});

describe("computeInlineDiff", () => {
  it("identical → single equal chunk", () => {
    const d = computeInlineDiff("hello", "hello");
    expect(d.chunks).toEqual([{ kind: "equal", text: "hello" }]);
  });

  it("addition only", () => {
    const d = computeInlineDiff("a\nb", "a\nb\nc");
    const kinds = d.chunks.map((c) => c.kind);
    expect(kinds).toContain("equal");
    expect(kinds).toContain("add");
    expect(kinds).not.toContain("remove");
  });

  it("removal only", () => {
    const d = computeInlineDiff("a\nb\nc", "a\nc");
    const kinds = d.chunks.map((c) => c.kind);
    expect(kinds).toContain("remove");
  });

  it("mixed add+remove", () => {
    const d = computeInlineDiff("hello world", "hello there");
    expect(d.chunks.some((c) => c.kind === "remove")).toBe(true);
    expect(d.chunks.some((c) => c.kind === "add")).toBe(true);
  });

  it("preserves original and proposed", () => {
    const d = computeInlineDiff("o", "p");
    expect(d.original).toBe("o");
    expect(d.proposed).toBe("p");
  });

  it("insertion before a common trailing line (in-loop add arm)", () => {
    // LCS = [a, c]; proposed inserts `b` between them → the main-loop `add`
    // branch fires (o[i] === lcs[k] but p[j] !== lcs[k]).
    const d = computeInlineDiff("a\nc", "a\nb\nc");
    const seq = d.chunks.map((c) => c.kind);
    expect(seq).toContain("equal");
    expect(seq).toContain("add");
    expect(d.chunks.some((c) => c.kind === "add" && c.text.includes("b"))).toBe(true);
    // No removals — only an insertion.
    expect(seq).not.toContain("remove");
  });

  it("trailing removal loop (original longer, common prefix only)", () => {
    // LCS = [a]; main loop exits when proposed is exhausted, leaving the
    // `while (i < o.length)` remove drain to run.
    const d = computeInlineDiff("a\nb\nc", "a");
    const removed = d.chunks.filter((c) => c.kind === "remove");
    expect(removed.length).toBeGreaterThan(0);
    const removedText = removed.map((c) => c.text).join("");
    expect(removedText).toContain("b");
    expect(removedText).toContain("c");
  });

  it("multi-line replacement exercises full LCS backtrack", () => {
    // Forces both the equal/non-equal dp fill arms and both backtrack arms.
    const original = "alpha\nbeta\ngamma\ndelta";
    const proposed = "alpha\nBETA\ngamma\nDELTA\nepsilon";
    const d = computeInlineDiff(original, proposed);
    const kinds = new Set(d.chunks.map((c) => c.kind));
    expect(kinds.has("equal")).toBe(true);
    expect(kinds.has("add")).toBe(true);
    expect(kinds.has("remove")).toBe(true);
    // equal lines preserved
    expect(d.chunks.some((c) => c.kind === "equal" && c.text.includes("alpha"))).toBe(true);
    expect(d.chunks.some((c) => c.kind === "equal" && c.text.includes("gamma"))).toBe(true);
  });

  it("strips the trailing newline when neither side ends with one (multi-line)", () => {
    const d = computeInlineDiff("x\ny", "x\nz");
    const last = d.chunks[d.chunks.length - 1];
    expect(last?.text.endsWith("\n")).toBe(false);
  });
});

describe("applyDecision", () => {
  it("accept returns proposed text", () => {
    const d = computeInlineDiff("a", "b");
    const r = applyDecision(d, "accept");
    expect(r.newText).toBe("b");
    expect(r.auditLine).toMatch(/accepted/);
  });

  it("reject returns null", () => {
    const d = computeInlineDiff("a", "b");
    const r = applyDecision(d, "reject");
    expect(r.newText).toBeNull();
    expect(r.auditLine).toMatch(/rejected/);
  });

  it("retry returns null + retry audit", () => {
    const d = computeInlineDiff("a", "b");
    const r = applyDecision(d, "retry");
    expect(r.newText).toBeNull();
    expect(r.auditLine).toMatch(/retry/);
  });

  it("audit truncates long text", () => {
    const long = "x".repeat(200);
    const d = computeInlineDiff(long, "short");
    const r = applyDecision(d, "accept");
    expect(r.auditLine.length).toBeLessThan(200);
  });
});
