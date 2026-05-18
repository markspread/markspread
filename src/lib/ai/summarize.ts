// S-AI-015 / S-AI-016: Summarize action.
//
// Three preset lengths drive the prompt template — the same prompt scaffold
// is reused so the user gets predictable output. The result lands in the
// Spread Pane AI tab (S-AI-016) so the source document is never mutated;
// users that want to commit the summary copy/paste it explicitly.

export type SummaryLength = "short" | "medium" | "long";

export const SUMMARY_LABEL: Record<SummaryLength, string> = {
  short: "ai.summarize.length.short",
  medium: "ai.summarize.length.medium",
  long: "ai.summarize.length.long",
};

export const SUMMARY_INSTRUCTION: Record<SummaryLength, string> = {
  short: "Summarize in one sentence.",
  medium: "Summarize in a single short paragraph.",
  long: "Summarize in 3 to 5 paragraphs.",
};

export interface SummarizePrompt {
  system: string;
  user: string;
}

export function buildSummarizePrompt(doc: string, length: SummaryLength): SummarizePrompt {
  return {
    system:
      "You are a careful editor. Preserve the document's tone and key facts. " +
      "Do not invent details. Output plain prose; no markdown headings.",
    user: `${SUMMARY_INSTRUCTION[length]}\n\n---\n${doc}\n---`,
  };
}

// Hand-off contract for S-AI-016 — the editor never gets these tokens.
export interface AiTabRecord {
  kind: "summary" | "outline" | "title" | "review-overview";
  body: string;
  /** Stream id so the AI tab can reconcile in-flight responses. */
  streamId: string;
  /** When the tab should show a spinner. */
  pending: boolean;
}
