// S-AI-017 / S-AI-018: Rewrite tone variants.
//
// Both formal and casual rewrites share a single pipeline that diffs the
// model output against the original selection so the user gets a per-line
// inline diff, not a wholesale replacement. We keep tone-specific guidance
// minimal — empirically, more directive prompts cause the model to inject
// content it shouldn't.

export type RewriteTone = "formal" | "casual";

export const REWRITE_GUIDANCE: Record<RewriteTone, string> = {
  formal:
    "Rewrite the user's text in a formal register suitable for a business " +
    "memo. Preserve every fact and reference. Do not add or remove ideas.",
  casual:
    "Rewrite the user's text in a casual, conversational register. Keep " +
    "the same facts. You may shorten sentences but must not add new ideas.",
};

export interface RewritePrompt {
  system: string;
  user: string;
}

export function buildRewritePrompt(selection: string, tone: RewriteTone): RewritePrompt {
  return {
    system: `${REWRITE_GUIDANCE[tone]}\n\nOutput only the rewritten passage; no preamble, no quotation marks, no commentary.`,
    user: selection,
  };
}
