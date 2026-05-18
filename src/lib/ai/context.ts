// S-AI-031..037: AI context assembly.
//
// Every action funnels through `buildContext` so we have a single place to
// enforce token budgets, secret masking, and gitignore filtering. The
// caller supplies the live editor state and the requested scope; we return
// a token-bounded payload with a manifest the UI can show ("included 3
// files, truncated to 8K tokens").

import { invoke } from "@tauri-apps/api/core";
import { estimateInputTokens } from "./cost-estimate";

export type ContextScope =
  | "selection" // S-AI-031
  | "selection-document" // S-AI-032
  | "backlinks" // S-AI-033
  | "workspace-glob"; // S-AI-034

export interface ContextRequest {
  scope: ContextScope;
  selection: string | null;
  documentText: string;
  documentPath: string | null;
  workspace: string | null;
  // S-AI-034: limit-to-glob, e.g. `docs/**/*.md`.
  glob?: string;
  /** S-AI-035: hard ceiling for the assembled prompt. */
  tokenBudget: number;
}

export interface ContextPayload {
  /** Final prompt text — already masked / truncated. */
  text: string;
  tokens: number;
  /** Per-source breakdown so the UI can render an "included" chip. */
  sources: { kind: string; path: string | null; tokens: number; truncated: boolean }[];
  /** S-AI-036: the count of secret-shaped strings that were redacted. */
  redactedSecrets: number;
}

// S-AI-036: minimal but punchy secret detector. We mask before the text
// ever leaves the renderer process — provider-side filtering would already
// be too late. The patterns cover the highest-impact accidental leaks
// (cloud keys, API tokens, JWTs); domain-specific secrets get added as
// teams report misses.
const SECRET_PATTERNS: { name: string; re: RegExp }[] = [
  { name: "aws-akia", re: /\bAKIA[0-9A-Z]{16}\b/g },
  { name: "aws-secret", re: /\b[A-Za-z0-9/+]{40}\b(?=\s*[\r\n])/g },
  { name: "github-token", re: /\bghp_[A-Za-z0-9]{36}\b/g },
  { name: "github-fine-grained", re: /\bgithub_pat_[A-Za-z0-9_]{82}\b/g },
  { name: "openai-key", re: /\bsk-[A-Za-z0-9]{20,}\b/g },
  { name: "anthropic-key", re: /\bsk-ant-[A-Za-z0-9-]{40,}\b/g },
  {
    name: "private-key-pem",
    re: /-----BEGIN (?:RSA |EC |OPENSSH |)PRIVATE KEY-----[\s\S]*?-----END[^-]*-----/g,
  },
  { name: "jwt", re: /\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\b/g },
];

export interface MaskResult {
  text: string;
  count: number;
}

export function maskSecrets(input: string): MaskResult {
  let text = input;
  let count = 0;
  for (const p of SECRET_PATTERNS) {
    text = text.replace(p.re, () => {
      count += 1;
      return `«REDACTED:${p.name}»`;
    });
  }
  return { text, count };
}

// S-AI-035: truncate a body to a token budget. We trim from the end so the
// model sees the *start* of the document — typically more contextually
// useful than the tail. Callers can flip via `keepTail` for chat-style
// continuation actions.
export function truncateToBudget(
  text: string,
  budget: number,
  keepTail = false,
): { text: string; tokens: number; truncated: boolean } {
  const fullTokens = estimateInputTokens(text);
  if (fullTokens <= budget) return { text, tokens: fullTokens, truncated: false };
  // Approximate the cut by ratio — Intl tokenizers aren't strictly
  // proportional but the heuristic is close enough for a UI cap, and we
  // re-estimate after the cut to surface the exact post-truncation count.
  const ratio = budget / fullTokens;
  const charBudget = Math.floor(text.length * ratio);
  const cut = keepTail ? text.slice(text.length - charBudget) : text.slice(0, charBudget);
  return { text: cut, tokens: estimateInputTokens(cut), truncated: true };
}

export async function buildContext(req: ContextRequest): Promise<ContextPayload> {
  const sources: ContextPayload["sources"] = [];
  let total = 0;
  let redacted = 0;
  const parts: string[] = [];

  function take(kind: string, path: string | null, body: string, share: number): void {
    const remaining = Math.max(0, req.tokenBudget - total);
    const cap = Math.floor(req.tokenBudget * share);
    const slice = truncateToBudget(body, Math.min(cap, remaining));
    const masked = maskSecrets(slice.text);
    redacted += masked.count;
    parts.push(`# ${kind}: ${path ?? "(inline)"}\n${masked.text}`);
    const tokens = estimateInputTokens(masked.text);
    sources.push({ kind, path, tokens, truncated: slice.truncated });
    total += tokens;
  }

  if (req.scope === "selection") {
    if (req.selection) take("selection", req.documentPath, req.selection, 1);
  } else if (req.scope === "selection-document") {
    if (req.selection) take("selection", req.documentPath, req.selection, 0.4);
    take("document", req.documentPath, req.documentText, 0.6);
  } else if (req.scope === "backlinks") {
    take("document", req.documentPath, req.documentText, 0.5);
    if (req.workspace && req.documentPath) {
      // S-AI-033: backlinks come from the workspace index — we ask the Rust
      // side because it already maintains the link graph for the Outline
      // pane. The graph respects S-AI-037's gitignore filter natively.
      try {
        const links = await invoke<{ path: string; excerpt: string }[]>("ai_context_backlinks", {
          workspace: req.workspace,
          file: req.documentPath,
          max: 10,
        });
        for (const link of links) {
          take("backlink", link.path, link.excerpt, 0.05);
        }
      } catch {
        // Backlink index isn't available yet — fall back to document only.
      }
    }
  } else if (req.scope === "workspace-glob" && req.workspace && req.glob) {
    // S-AI-034 / S-AI-037: Rust side enumerates files honouring .gitignore
    // and applies the glob filter, returning at most N files keyed by
    // relevance (most-recently-modified first).
    try {
      const files = await invoke<{ path: string; body: string }[]>("ai_context_glob", {
        workspace: req.workspace,
        glob: req.glob,
        max: 20,
      });
      const share = files.length === 0 ? 0 : 1 / files.length;
      for (const f of files) take("workspace", f.path, f.body, share);
    } catch {
      // Workspace enumeration failed — keep going with whatever we collected.
    }
  }

  return {
    text: parts.join("\n\n"),
    tokens: total,
    sources,
    redactedSecrets: redacted,
  };
}
