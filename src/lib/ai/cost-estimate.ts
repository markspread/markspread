// S-AI-003: token & cost estimation for the pre-run chip.
//
// We don't ship a tokenizer per provider — that would bloat the bundle and
// drift from upstream model versions. Instead we use a conservative
// heuristic that's known to be within ~20% of GPT/Claude tokenizers on
// natural language: 1 token ≈ 4 characters of English, 1 token ≈ 2 chars
// for CJK. The result is a *preview* — the actual billing comes from the
// provider's response usage block (S-AIC).

export interface CostEstimate {
  tokens: number;
  /** USD, rounded to 4 decimals so sub-cent estimates render legibly. */
  usd: number;
}

export interface ModelPricing {
  /** USD per 1K input tokens. */
  inputPer1K: number;
  /** USD per 1K output tokens. */
  outputPer1K: number;
  /** Estimated output : input ratio (e.g. 0.3 means output ≈ 30% of input). */
  outputRatio: number;
}

// Rough public pricing snapshot (as of late 2025). Real values are pulled
// from the provider catalog at runtime once S-AIC lands; this default is
// only used when the user hasn't picked a model yet.
export const DEFAULT_PRICING: ModelPricing = {
  inputPer1K: 0.003,
  outputPer1K: 0.015,
  outputRatio: 0.3,
};

const CJK_RANGE = /[　-鿿가-힯＀-￯]/;

export function estimateInputTokens(text: string): number {
  if (!text) return 0;
  let cjk = 0;
  let other = 0;
  for (const ch of text) {
    if (CJK_RANGE.test(ch)) cjk += 1;
    else other += 1;
  }
  return Math.ceil(cjk / 2 + other / 4);
}

export function estimateCost(
  inputText: string,
  pricing: ModelPricing = DEFAULT_PRICING,
): CostEstimate {
  const input = estimateInputTokens(inputText);
  const output = Math.ceil(input * pricing.outputRatio);
  const usd = (input / 1000) * pricing.inputPer1K + (output / 1000) * pricing.outputPer1K;
  return { tokens: input + output, usd: Math.round(usd * 10000) / 10000 };
}

export function formatTokens(n: number): string {
  if (n < 1000) return `${n}`;
  return `${(n / 1000).toFixed(1)}K`;
}
