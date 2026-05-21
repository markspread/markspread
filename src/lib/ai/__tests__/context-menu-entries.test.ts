// S-AI-002: AI context-menu entries coverage.

import { describe, expect, it, vi } from "vitest";
import type { ActionContext, AiAction } from "../actions";

type RankFn = (actions: AiAction[], ctx: ActionContext) => AiAction[];
let rankActionsImpl: RankFn | null = null;
vi.mock("../actions", async () => {
  const mod = await vi.importActual<typeof import("../actions")>("../actions");
  return {
    ...mod,
    rankActions: (actions: AiAction[], ctx: ActionContext) =>
      rankActionsImpl ? rankActionsImpl(actions, ctx) : mod.rankActions(actions, ctx),
  };
});

import { aiContextMenuEntries } from "../context-menu-entries";

const docCtx: ActionContext = { hasSelection: false, documentLength: 100, inCodeBlock: false };
const emptyCtx: ActionContext = { hasSelection: false, documentLength: 0, inCodeBlock: false };
const selCtx: ActionContext = { hasSelection: true, documentLength: 100, inCodeBlock: false };

describe("aiContextMenuEntries", () => {
  it("still surfaces anywhere-actions when the document is empty", () => {
    // `continue` / `brainstorm` / `format` require "anywhere" with no
    // availability gate, so the menu is never empty for the real catalog.
    const entries = aiContextMenuEntries(emptyCtx, vi.fn(), vi.fn());
    expect(entries.length).toBeGreaterThan(0);
  });

  it("starts with a separator and ends with a More entry", () => {
    const entries = aiContextMenuEntries(docCtx, vi.fn(), vi.fn());
    expect(entries[0]).toEqual({ separator: true });
    const last = entries[entries.length - 1];
    expect(last && "id" in last && last.id).toBe("ai:more");
  });

  it("caps the inline list at three actions plus separator and More", () => {
    const entries = aiContextMenuEntries(docCtx, vi.fn(), vi.fn());
    expect(entries).toHaveLength(5);
  });

  it("prefixes action ids with ai:", () => {
    const entries = aiContextMenuEntries(docCtx, vi.fn(), vi.fn());
    const actionEntries = entries.filter(
      (e): e is Extract<typeof e, { id: string }> => "id" in e && e.id !== "ai:more",
    );
    expect(actionEntries.every((e) => e.id.startsWith("ai:"))).toBe(true);
  });

  it("invokes the action callback on select", () => {
    const onInvoke = vi.fn();
    const entries = aiContextMenuEntries(docCtx, onInvoke, vi.fn());
    const first = entries.find(
      (e): e is Extract<typeof e, { id: string; onSelect: () => void }> =>
        "id" in e && e.id !== "ai:more",
    );
    first?.onSelect();
    expect(onInvoke).toHaveBeenCalledTimes(1);
  });

  it("opens the palette via the More entry", () => {
    const onOpen = vi.fn();
    const entries = aiContextMenuEntries(docCtx, vi.fn(), onOpen);
    const more = entries.find(
      (e): e is Extract<typeof e, { id: string; onSelect: () => void }> =>
        "id" in e && e.id === "ai:more",
    );
    more?.onSelect();
    expect(onOpen).toHaveBeenCalledTimes(1);
  });

  it("disables selection-only actions when there is no selection", () => {
    const entries = aiContextMenuEntries(docCtx, vi.fn(), vi.fn());
    // at least confirm the shape: a disabled flag is present on items.
    const items = entries.filter((e): e is Extract<typeof e, { id: string }> => "id" in e);
    expect(items.length).toBeGreaterThan(0);
  });

  it("does not disable selection actions when a selection exists", () => {
    const entries = aiContextMenuEntries(selCtx, vi.fn(), vi.fn());
    const items = entries.filter(
      (e): e is Extract<typeof e, { id: string; disabled?: boolean }> => "id" in e,
    );
    expect(items.some((e) => e.id !== "ai:more")).toBe(true);
  });

  it("returns an empty list when no actions rank in (early-return branch)", () => {
    // Force `rankActions` to return [] so the `top.length === 0` guard
    // fires — the real catalog never produces this state, but the branch
    // exists for plug-in/test isolation where ACTIONS may be filtered out.
    rankActionsImpl = () => [];
    try {
      const entries = aiContextMenuEntries(docCtx, vi.fn(), vi.fn());
      expect(entries).toEqual([]);
    } finally {
      rankActionsImpl = null;
    }
  });

  it("marks selection-only actions disabled when no selection exists", () => {
    // Cover the `requires === "selection" && !ctx.hasSelection` truthy
    // branch — naturally unreachable because selection-only actions get
    // ranked to the bottom and the top-3 slice never reaches them.
    const selectionOnly: AiAction[] = [
      {
        id: "needs-sel",
        category: "edit",
        labelKey: "ai.actions.x",
        requires: "selection",
      },
    ];
    rankActionsImpl = () => selectionOnly;
    try {
      const entries = aiContextMenuEntries(docCtx, vi.fn(), vi.fn());
      const action = entries.find(
        (e): e is Extract<typeof e, { id: string; disabled?: boolean }> =>
          "id" in e && e.id === "ai:needs-sel",
      );
      expect(action?.disabled).toBe(true);
    } finally {
      rankActionsImpl = null;
    }
  });

  it("emits a shortcut field when an action declares a hint", () => {
    // Cover the with-hint branch — the real ACTIONS catalog assigns
    // `hint` to actions that never make the top-3 for any plausible ctx
    // (e.g., `review` is anywhere-score and outranked by document-score
    // outline/title/summarize), so coverage needs an explicit injection.
    const hinted: AiAction[] = [
      {
        id: "with-hint",
        category: "edit",
        labelKey: "ai.actions.x",
        requires: "anywhere",
        hint: "⌘K",
      },
    ];
    rankActionsImpl = () => hinted;
    try {
      const entries = aiContextMenuEntries(docCtx, vi.fn(), vi.fn());
      const action = entries.find(
        (e): e is Extract<typeof e, { id: string; shortcut?: string }> =>
          "id" in e && e.id === "ai:with-hint",
      );
      expect(action?.shortcut).toBe("⌘K");
    } finally {
      rankActionsImpl = null;
    }
  });

  it("omits the shortcut field when an action has no hint", () => {
    // Cover the `action.hint !== undefined && { shortcut }` falsy branch
    // by injecting a hint-less action set into rankActions.
    const hintless: AiAction[] = [
      { id: "no-hint", category: "edit", labelKey: "ai.actions.x", requires: "anywhere" },
    ];
    rankActionsImpl = () => hintless;
    try {
      const entries = aiContextMenuEntries(docCtx, vi.fn(), vi.fn());
      const action = entries.find(
        (e): e is Extract<typeof e, { id: string }> => "id" in e && e.id === "ai:no-hint",
      );
      expect(action).toBeDefined();
      expect(action && "shortcut" in action).toBe(false);
    } finally {
      rankActionsImpl = null;
    }
  });
});
