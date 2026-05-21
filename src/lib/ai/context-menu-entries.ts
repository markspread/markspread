import type { ContextMenuEntry } from "../../components/ContextMenu";
import { ACTIONS, type ActionContext, rankActions } from "./actions";

// S-AI-002: append AI Actions to the editor's right-click context menu.
//
// We intentionally cap the inline menu at the top three context-relevant
// actions and offer "More…" as the escape hatch into the full ⌘. palette.
// Anything beyond that bloats the menu and slows down keyboard users who
// have to scan past it for the more common Cut / Copy / Paste rows.

const INLINE_LIMIT = 3;

export function aiContextMenuEntries(
  ctx: ActionContext,
  onInvoke: (actionId: string) => void,
  onOpenPalette: () => void,
): ContextMenuEntry[] {
  const ranked = rankActions(ACTIONS, ctx);
  const top = ranked.slice(0, INLINE_LIMIT);
  if (top.length === 0) return [];
  const entries: ContextMenuEntry[] = [{ separator: true }];
  for (const action of top) {
    const base = {
      id: `ai:${action.id}`,
      label: action.labelKey,
      disabled: action.requires === "selection" && !ctx.hasSelection,
      onSelect: () => onInvoke(action.id),
    };
    // exactOptionalPropertyTypes: assign `shortcut` only when defined.
    if (action.hint !== undefined) {
      entries.push({ ...base, shortcut: action.hint });
    } else {
      entries.push(base);
    }
  }
  entries.push({
    id: "ai:more",
    label: "ai.menu.more",
    shortcut: "⌘.",
    onSelect: onOpenPalette,
  });
  return entries;
}
