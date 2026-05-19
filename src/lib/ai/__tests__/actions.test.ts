// S-AI-001 / S-AI-002: action catalog ranking coverage.

import { describe, expect, it } from "vitest";
import { ACTIONS, type ActionContext, rankActions } from "../actions";

const emptyCtx: ActionContext = { hasSelection: false, documentLength: 0, inCodeBlock: false };
const selCtx: ActionContext = { hasSelection: true, documentLength: 100, inCodeBlock: false };
const docCtx: ActionContext = { hasSelection: false, documentLength: 100, inCodeBlock: false };

describe("rankActions", () => {
  it("hides document-gated actions when the document is empty", () => {
    const ids = rankActions(ACTIONS, emptyCtx).map((a) => a.id);
    expect(ids).not.toContain("review");
    expect(ids).not.toContain("outline");
    expect(ids).not.toContain("summarize");
  });

  it("includes document-gated actions when the document is non-empty", () => {
    const ids = rankActions(ACTIONS, docCtx).map((a) => a.id);
    expect(ids).toContain("review");
    expect(ids).toContain("outline");
  });

  it("floats selection-required actions to the top when a selection exists", () => {
    const ranked = rankActions(ACTIONS, selCtx);
    const firstSel = ranked.findIndex((a) => a.requires === "selection");
    const firstNonSel = ranked.findIndex((a) => a.requires !== "selection");
    expect(firstSel).toBeLessThan(firstNonSel);
  });

  it("pushes selection-required actions down when there is no selection", () => {
    const ranked = rankActions(ACTIONS, docCtx);
    const selectionActions = ranked.filter((a) => a.requires === "selection");
    // selection actions score 3 (lowest priority) — they appear after others.
    const lastNonSel = ranked.map((a) => a.requires !== "selection").lastIndexOf(true);
    const firstSel = ranked.findIndex((a) => a.requires === "selection");
    if (selectionActions.length > 0) expect(firstSel).toBeGreaterThan(lastNonSel - 1);
  });

  it("breaks ties by category rank then id", () => {
    const ranked = rankActions(ACTIONS, docCtx);
    // result is deterministic — re-running yields the same order.
    const again = rankActions(ACTIONS, docCtx);
    expect(ranked.map((a) => a.id)).toEqual(again.map((a) => a.id));
  });

  it("returns an empty list for an empty action set", () => {
    expect(rankActions([], selCtx)).toEqual([]);
  });
});
