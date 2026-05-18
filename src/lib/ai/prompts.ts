// S-AI-019..024: prompt scaffolds for the remaining text-generation actions.
//
// Each builder returns a `{ system, user }` pair so the provider runner
// (S-AIK) can plug them into either Claude's role-based API or OpenAI's
// chat completions without conditional logic per action.

export interface BuiltPrompt {
  system: string;
  user: string;
}

// S-AI-019: continue at cursor. We pass a generous tail of preceding text
// (bounded so we don't blow the context window) and ask for a single
// paragraph continuation. The caller is expected to crop the response to
// one paragraph if the model overshoots.
export function buildContinuePrompt(precedingText: string): BuiltPrompt {
  const tail = precedingText.slice(-4000);
  return {
    system:
      "You continue prose in the user's voice. Match tone, tense, and " +
      "vocabulary. Do not summarize or restate prior text. Stop after one " +
      "paragraph.",
    user: tail,
  };
}

// S-AI-020: brainstorm. Returns a bullet list — formatted to be pasted
// directly into the editor without extra processing.
export function buildBrainstormPrompt(topic: string): BuiltPrompt {
  return {
    system:
      "You are a brainstorming partner. Output exactly 8 short bullets, one " +
      "idea per line, prefixed with `- `. No headings, no commentary.",
    user: topic.trim() || "Brainstorm angles for the document above.",
  };
}

// S-AI-021: outline.
export function buildOutlinePrompt(doc: string): BuiltPrompt {
  return {
    system:
      "Produce a document outline. Use markdown headings (# / ## / ###) and " +
      "preserve the original ordering of ideas. Output only the outline.",
    user: doc,
  };
}

// S-AI-022: title suggestions. Returns up to 5 candidates so the caller can
// surface them as a quick-pick list.
export function buildTitlePrompt(doc: string): BuiltPrompt {
  return {
    system:
      "Suggest exactly 5 concise titles for the document. Output as a plain " +
      "numbered list, one title per line, without quotes.",
    user: doc.slice(0, 6000),
  };
}

// S-AI-023: fact-check. We instruct the model to cite sources where possible
// and to flag claims it cannot verify so the UI can render a status badge.
export function buildFactCheckPrompt(selection: string): BuiltPrompt {
  return {
    system:
      "For each factual claim in the user's text, output one line:\n" +
      "  CLAIM: <claim>\n" +
      "  STATUS: verified|unverified|disputed\n" +
      "  SOURCE: <url or 'none'>\n" +
      "Do not invent sources.",
    user: selection,
  };
}

// S-AI-024: format. Re-renders markdown to a canonical form so users can
// adopt a consistent style without manual cleanup.
export function buildFormatPrompt(doc: string): BuiltPrompt {
  return {
    system:
      "Reformat the markdown to canonical CommonMark + GFM. Preserve every " +
      "word and reference exactly. Standardise heading depth, list markers, " +
      "and table column alignment. Output only the reformatted markdown.",
    user: doc,
  };
}
