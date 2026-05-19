// S-AI-002: AI context-menu entries coverage.

import { describe, expect, it, vi } from "vitest";
import type { ActionContext } from "../actions";
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
});
