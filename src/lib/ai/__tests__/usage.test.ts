// S-AIC: AI usage accounting + cost helpers coverage.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const invokeMock = vi.fn();
vi.mock("@tauri-apps/api/core", () => ({
  invoke: (...args: unknown[]) => invokeMock(...args),
}));

import {
  BUILTIN_PRICING,
  type CostThreshold,
  DEFAULT_THRESHOLD,
  type UsageRow,
  computeUsd,
  evaluateThreshold,
  formatUsageCsv,
  priceFor,
  queryUsage,
  recordUsage,
  resetUsage,
  startOfDay,
  startOfMonth,
} from "../usage";

beforeEach(() => {
  invokeMock.mockReset();
});

afterEach(() => {
  invokeMock.mockReset();
});

describe("priceFor", () => {
  it("finds an exact provider+model row", () => {
    const row = priceFor(BUILTIN_PRICING, "anthropic", "claude-opus-4-7");
    expect(row?.inputPerMTok).toBe(15);
  });

  it("falls back to a wildcard model row", () => {
    const row = priceFor(BUILTIN_PRICING, "ollama", "any-local-model");
    expect(row?.inputPerMTok).toBe(0);
  });

  it("returns null for an unknown provider", () => {
    expect(priceFor(BUILTIN_PRICING, "openai", "no-such-model")).toBeNull();
  });
});

describe("computeUsd", () => {
  it("computes cost from input and output tokens", () => {
    // 1M input @ 3, 1M output @ 15 => 18 usd
    const usd = computeUsd(BUILTIN_PRICING, "anthropic", "claude-sonnet-4-6", 1_000_000, 1_000_000);
    expect(usd).toBeCloseTo(18, 6);
  });

  it("returns 0 when there is no pricing row", () => {
    expect(computeUsd(BUILTIN_PRICING, "openai", "unknown", 100, 100)).toBe(0);
  });

  it("returns 0 for an ollama (local) model", () => {
    expect(computeUsd(BUILTIN_PRICING, "ollama", "llama3.3", 5000, 5000)).toBe(0);
  });
});

describe("startOfDay / startOfMonth", () => {
  it("startOfDay zeroes the time-of-day", () => {
    const d = new Date(2026, 4, 19, 14, 33, 12);
    const s = new Date(startOfDay(d.getTime()));
    expect(s.getHours()).toBe(0);
    expect(s.getMinutes()).toBe(0);
    expect(s.getDate()).toBe(19);
  });

  it("startOfMonth resets to day 1 at midnight", () => {
    const d = new Date(2026, 4, 19, 14, 33, 12);
    const s = new Date(startOfMonth(d.getTime()));
    expect(s.getDate()).toBe(1);
    expect(s.getHours()).toBe(0);
    expect(s.getMonth()).toBe(4);
  });
});

describe("evaluateThreshold", () => {
  it("returns ok when the threshold is disabled", () => {
    expect(evaluateThreshold(DEFAULT_THRESHOLD, 9999).kind).toBe("ok");
  });

  it("returns ok when the limit is non-positive", () => {
    const t: CostThreshold = { ...DEFAULT_THRESHOLD, enabled: true, monthlyUsdLimit: 0 };
    expect(evaluateThreshold(t, 100).kind).toBe("ok");
  });

  it("returns ok when usage is well under the limit", () => {
    const t: CostThreshold = { ...DEFAULT_THRESHOLD, enabled: true, monthlyUsdLimit: 100 };
    expect(evaluateThreshold(t, 10).kind).toBe("ok");
  });

  it("returns warn at 80% of the limit", () => {
    const t: CostThreshold = { ...DEFAULT_THRESHOLD, enabled: true, monthlyUsdLimit: 100 };
    const r = evaluateThreshold(t, 85);
    expect(r.kind).toBe("warn");
  });

  it("returns warn at 100% when blockAtLimit is false", () => {
    const t: CostThreshold = { ...DEFAULT_THRESHOLD, enabled: true, monthlyUsdLimit: 100 };
    expect(evaluateThreshold(t, 120).kind).toBe("warn");
  });

  it("returns block at 100% when blockAtLimit is true", () => {
    const t: CostThreshold = {
      ...DEFAULT_THRESHOLD,
      enabled: true,
      monthlyUsdLimit: 100,
      blockAtLimit: true,
    };
    const r = evaluateThreshold(t, 120);
    expect(r.kind).toBe("block");
    if (r.kind === "block") expect(r.usedUsd).toBe(120);
  });
});

describe("formatUsageCsv", () => {
  const row: UsageRow = {
    id: "1",
    ts: Date.parse("2026-05-19T00:00:00Z"),
    alias: "default",
    provider: "anthropic",
    model: "claude-opus-4-7",
    actionId: "summarize",
    inputTokens: 100,
    outputTokens: 50,
    usd: 0.001234,
    pricingVersion: "2026-05-01",
    status: "ok",
  };

  it("emits a BOM-prefixed CRLF csv with a header", () => {
    const csv = formatUsageCsv([row]);
    expect(csv.startsWith("﻿")).toBe(true);
    expect(csv).toContain("ts,alias,provider");
    expect(csv).toContain("\r\n");
    expect(csv).toContain("0.001234");
  });

  it("escapes fields containing commas or quotes", () => {
    const csv = formatUsageCsv([{ ...row, actionId: 'a,"b"' }]);
    expect(csv).toContain('"a,""b"""');
  });

  it("renders a header-only csv for an empty row set", () => {
    const csv = formatUsageCsv([]);
    expect(csv).toContain("ts,alias,provider");
  });
});

describe("invoke wrappers", () => {
  it("recordUsage forwards the row to ai_usage_record", async () => {
    invokeMock.mockResolvedValueOnce(undefined);
    const row: Omit<UsageRow, "id"> = {
      ts: 1,
      alias: "default",
      provider: "anthropic",
      model: "claude-opus-4-7",
      actionId: "review",
      inputTokens: 10,
      outputTokens: 5,
      usd: 0.01,
      pricingVersion: "2026-05-01",
      status: "ok",
    };
    await recordUsage(row);
    expect(invokeMock).toHaveBeenCalledWith("ai_usage_record", { row });
  });

  it("queryUsage forwards the window to ai_usage_query", async () => {
    invokeMock.mockResolvedValueOnce({
      startTs: 0,
      endTs: 100,
      totalUsd: 1,
      totalInputTokens: 2,
      totalOutputTokens: 3,
      dailyBuckets: [],
      byModel: [],
      byAction: [],
    });
    const r = await queryUsage(0, 100);
    expect(invokeMock).toHaveBeenCalledWith("ai_usage_query", { startTs: 0, endTs: 100 });
    expect(r.totalUsd).toBe(1);
  });

  it("resetUsage calls ai_usage_reset", async () => {
    invokeMock.mockResolvedValueOnce(undefined);
    await resetUsage();
    expect(invokeMock).toHaveBeenCalledWith("ai_usage_reset");
  });
});
