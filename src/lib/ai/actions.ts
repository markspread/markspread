// S-AI-001 / S-AI-002: action catalog for the AI palette and right-click menu.
//
// Actions are grouped by category so the palette can render section headers
// and so we can prioritise context-aware ones — when there's a selection the
// Edit group jumps to the top of the list, otherwise Generate / Brainstorm
// take precedence. Each action is a pure descriptor here; the runtime side
// (provider selection, streaming, undo group) lives in `runner.ts` once the
// AI provider layer (S-AIK) is wired in.

export type ActionCategory =
  | "edit"
  | "generate"
  | "translate"
  | "summarize"
  | "custom";

export interface AiAction {
  id: string;
  category: ActionCategory;
  /** i18n key — resolved at render time so palette labels follow live locale. */
  labelKey: string;
  /** Hint for the palette to grey-out / hide if the precondition isn't met. */
  requires: "selection" | "document" | "anywhere";
  /** Default keyboard hint shown next to the label (the canonical binding). */
  hint?: string;
  /**
   * Optional context filter. The palette calls this when computing the
   * sorted list — return false to omit the action entirely (vs returning
   * `requires` mismatches, which dim it). Used by S-AI-004 to hide Review
   * actions when the document is empty.
   */
  available?: (ctx: ActionContext) => boolean;
}

export interface ActionContext {
  hasSelection: boolean;
  documentLength: number;
  /** Set by the editor when the cursor sits inside a fenced code block. */
  inCodeBlock: boolean;
}

export const ACTIONS: AiAction[] = [
  // --- Edit group -------------------------------------------------------
  { id: "review", category: "edit", labelKey: "ai.actions.review", requires: "anywhere", hint: "⌘.", available: (c) => c.documentLength > 0 },
  { id: "translate", category: "translate", labelKey: "ai.actions.translate", requires: "anywhere" },
  { id: "rewrite-formal", category: "edit", labelKey: "ai.actions.rewrite_formal", requires: "selection" },
  { id: "rewrite-casual", category: "edit", labelKey: "ai.actions.rewrite_casual", requires: "selection" },
  { id: "format", category: "edit", labelKey: "ai.actions.format", requires: "anywhere" },
  // --- Generate group ---------------------------------------------------
  { id: "continue", category: "generate", labelKey: "ai.actions.continue", requires: "anywhere" },
  { id: "brainstorm", category: "generate", labelKey: "ai.actions.brainstorm", requires: "anywhere" },
  { id: "outline", category: "generate", labelKey: "ai.actions.outline", requires: "document", available: (c) => c.documentLength > 0 },
  { id: "title", category: "generate", labelKey: "ai.actions.title", requires: "document", available: (c) => c.documentLength > 0 },
  // --- Summarize / inspect group ---------------------------------------
  { id: "summarize", category: "summarize", labelKey: "ai.actions.summarize", requires: "document", available: (c) => c.documentLength > 0 },
  { id: "fact-check", category: "summarize", labelKey: "ai.actions.fact_check", requires: "selection" },
];

const CATEGORY_RANK: Record<ActionCategory, number> = {
  edit: 0,
  generate: 1,
  translate: 2,
  summarize: 3,
  custom: 4,
};

/**
 * Returns the actions to render in the palette, ordered by relevance to the
 * current context. The order has two phases: (1) actions whose `requires`
 * matches the context float to the top, (2) ties break by category rank.
 */
export function rankActions(actions: AiAction[], ctx: ActionContext): AiAction[] {
  const filtered = actions.filter((a) => a.available?.(ctx) ?? true);
  const score = (a: AiAction): number => {
    if (a.requires === "selection" && ctx.hasSelection) return 0;
    if (a.requires === "selection" && !ctx.hasSelection) return 3;
    if (a.requires === "document" && ctx.documentLength > 0) return 1;
    return 2;
  };
  return [...filtered].sort((a, b) => {
    const sa = score(a);
    const sb = score(b);
    if (sa !== sb) return sa - sb;
    const ca = CATEGORY_RANK[a.category];
    const cb = CATEGORY_RANK[b.category];
    if (ca !== cb) return ca - cb;
    return a.id.localeCompare(b.id);
  });
}
