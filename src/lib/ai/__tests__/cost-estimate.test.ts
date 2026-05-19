// S-AI-003: token & cost estimation coverage.

import { describe, expect, it } from "vitest";
import {
  DEFAULT_PRICING,
  type ModelPricing,
  estimateCost,
  estimateInputTokens,
  formatTokens,
} from "../cost-estimate";

describe("estimateInputTokens", () => {
  it("returns 0 for empty text", () => {
    expect(estimateInputTokens("")).toBe(0);
  });

  it("uses ~4 chars per token for ASCII", () => {
    expect(estimateInputTokens("abcd")).toBe(1);
    expect(estimateInputTokens("abcdefgh")).toBe(2);
  });

  it("uses ~2 chars per token for CJK", () => {
    expect(estimateInputTokens("한국어단어")).toBe(3);
  });

  it("mixes CJK and ASCII counts", () => {
    // 4 ascii (1 tok) + 2 cjk (1 tok) = 2
    expect(estimateInputTokens("abcd한국")).toBe(2);
  });
});

describe("estimateCost", () => {
  it("computes input + output tokens and usd with default pricing", () => {
    const r = estimateCost("a".repeat(4000));
    expect(r.tokens).toBeGreaterThan(0);
    expect(r.usd).toBeGreaterThan(0);
  });

  it("rounds usd to 4 decimal places", () => {
    const r = estimateCost("hello world");
    expect(Number.isFinite(r.usd)).toBe(true);
    expect(r.usd).toBe(Math.round(r.usd * 10000) / 10000);
  });

  it("honours a custom pricing table", () => {
    const pricing: ModelPricing = { inputPer1K: 1, outputPer1K: 2, outputRatio: 0.5 };
    const r = estimateCost("a".repeat(4000), pricing);
    // 1000 input tokens, 500 output tokens => 1 + 1 = 2 usd
    expect(r.usd).toBeCloseTo(2, 4);
    expect(r.tokens).toBe(1500);
  });

  it("returns 0 cost for empty input", () => {
    const r = estimateCost("");
    expect(r.tokens).toBe(0);
    expect(r.usd).toBe(0);
  });

  it("DEFAULT_PRICING is exposed and sane", () => {
    expect(DEFAULT_PRICING.inputPer1K).toBeGreaterThan(0);
    expect(DEFAULT_PRICING.outputRatio).toBeGreaterThan(0);
  });
});

describe("formatTokens", () => {
  it("renders small counts verbatim", () => {
    expect(formatTokens(0)).toBe("0");
    expect(formatTokens(999)).toBe("999");
  });

  it("renders thousands with one decimal and K suffix", () => {
    expect(formatTokens(1000)).toBe("1.0K");
    expect(formatTokens(2500)).toBe("2.5K");
  });
});
