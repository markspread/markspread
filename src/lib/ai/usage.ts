// S-AIC-001..012: AI usage accounting + cost dashboard backend.
//
// We record one row per completed action (success, error, abort) with
// model, alias, token counts, USD cost, and timestamp. The renderer
// summarises locally for the status bar and dashboard charts; raw rows
// live in SQLite (Tauri side, alongside ai-history) so usage survives
// restarts and can be exported as CSV.
//
// Cost is computed at record-time using a built-in pricing table. The
// table has a `version` field so a monthly update can ship via the
// updater (S-AIC-003) without re-deriving past rows — historical cost is
// frozen at the rate that was current when the row was written.

import { invoke } from "@tauri-apps/api/core";
import type { ProviderId } from "./providers";

// S-AIC-002 / S-AIC-003: per-(provider × model) USD prices per 1M tokens.
// The version stamps the table so users / support can identify which row
// of pricing was applied to a given log line.
export interface PricingTable {
  version: string;
  effectiveAt: number;
  rows: PricingRow[];
}

export interface PricingRow {
  provider: ProviderId;
  model: string;
  inputPerMTok: number;
  outputPerMTok: number;
}

export const BUILTIN_PRICING: PricingTable = {
  version: "2026-05-01",
  effectiveAt: Date.parse("2026-05-01T00:00:00Z"),
  rows: [
    { provider: "anthropic", model: "claude-opus-4-7", inputPerMTok: 15, outputPerMTok: 75 },
    { provider: "anthropic", model: "claude-sonnet-4-6", inputPerMTok: 3, outputPerMTok: 15 },
    {
      provider: "anthropic",
      model: "claude-haiku-4-5-20251001",
      inputPerMTok: 1,
      outputPerMTok: 5,
    },
    { provider: "openai", model: "gpt-5", inputPerMTok: 5, outputPerMTok: 20 },
    { provider: "openai", model: "gpt-5-mini", inputPerMTok: 0.5, outputPerMTok: 2 },
    { provider: "openai", model: "gpt-4.1", inputPerMTok: 2, outputPerMTok: 8 },
    { provider: "google", model: "gemini-2.5-pro", inputPerMTok: 1.25, outputPerMTok: 10 },
    { provider: "google", model: "gemini-2.5-flash", inputPerMTok: 0.075, outputPerMTok: 0.3 },
    { provider: "xai", model: "grok-4", inputPerMTok: 5, outputPerMTok: 15 },
    { provider: "xai", model: "grok-3-mini", inputPerMTok: 0.3, outputPerMTok: 0.5 },
    { provider: "deepseek", model: "deepseek-chat", inputPerMTok: 0.27, outputPerMTok: 1.1 },
    { provider: "deepseek", model: "deepseek-reasoner", inputPerMTok: 0.55, outputPerMTok: 2.19 },
    { provider: "mistral", model: "mistral-large-latest", inputPerMTok: 2, outputPerMTok: 6 },
    { provider: "mistral", model: "mistral-small-latest", inputPerMTok: 0.2, outputPerMTok: 0.6 },
    // S-AIC-002: Ollama is local — zero marginal cost for log purposes.
    { provider: "ollama", model: "*", inputPerMTok: 0, outputPerMTok: 0 },
  ],
};

export function priceFor(
  table: PricingTable,
  provider: ProviderId,
  model: string,
): PricingRow | null {
  return (
    table.rows.find((r) => r.provider === provider && r.model === model) ??
    table.rows.find((r) => r.provider === provider && r.model === "*") ??
    null
  );
}

export function computeUsd(
  table: PricingTable,
  provider: ProviderId,
  model: string,
  inputTokens: number,
  outputTokens: number,
): number {
  const row = priceFor(table, provider, model);
  if (!row) return 0;
  return (
    (inputTokens / 1_000_000) * row.inputPerMTok + (outputTokens / 1_000_000) * row.outputPerMTok
  );
}

// S-AIC-001: usage row written every time an action completes.
export interface UsageRow {
  id: string;
  ts: number;
  alias: string;
  provider: ProviderId;
  model: string;
  actionId: string;
  inputTokens: number;
  outputTokens: number;
  usd: number;
  pricingVersion: string;
  /** "ok" | "error" | "aborted" — abort still bills for tokens already streamed. */
  status: "ok" | "error" | "aborted";
}

export async function recordUsage(row: Omit<UsageRow, "id">): Promise<void> {
  await invoke("ai_usage_record", { row });
}

// Period query: Rust side aggregates rows in the requested window so we
// don't ship 50K rows just to draw a chart. Status-bar reads use this
// for "today" and "month".
export interface UsagePeriod {
  startTs: number;
  endTs: number;
  totalUsd: number;
  totalInputTokens: number;
  totalOutputTokens: number;
  /** Per-day buckets for chart rendering (S-AIC-006). */
  dailyBuckets: { dayStart: number; usd: number; input: number; output: number }[];
  /** Per-model breakdown (S-AIC-007). */
  byModel: { provider: ProviderId; model: string; usd: number; calls: number }[];
  /** Per-action breakdown (S-AIC-008). */
  byAction: { actionId: string; usd: number; calls: number }[];
}

export async function queryUsage(startTs: number, endTs: number): Promise<UsagePeriod> {
  return invoke<UsagePeriod>("ai_usage_query", { startTs, endTs });
}

export function startOfDay(ts: number): number {
  const d = new Date(ts);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

export function startOfMonth(ts: number): number {
  const d = new Date(ts);
  d.setDate(1);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

// S-AIC-009 / S-AIC-010: monthly threshold, opt-in. The defaults below
// are user-configurable in Settings → AI → Cost. `block` causes new
// actions to refuse with a "monthly limit reached — confirm to override"
// dialog rather than silently piling up charges.
export interface CostThreshold {
  enabled: boolean;
  monthlyUsdLimit: number;
  /** When `true`, hitting the limit blocks new actions; `false` only toasts. */
  blockAtLimit: boolean;
  /** Last toast timestamp so we don't spam. */
  lastWarnedAt: number;
}

export const DEFAULT_THRESHOLD: CostThreshold = {
  enabled: false,
  monthlyUsdLimit: 25,
  blockAtLimit: false,
  lastWarnedAt: 0,
};

export type ThresholdEvaluation =
  | { kind: "ok" }
  | { kind: "warn"; usedUsd: number; limitUsd: number; pct: number }
  | { kind: "block"; usedUsd: number; limitUsd: number };

export function evaluateThreshold(
  threshold: CostThreshold,
  monthSoFarUsd: number,
): ThresholdEvaluation {
  if (!threshold.enabled || threshold.monthlyUsdLimit <= 0) return { kind: "ok" };
  const pct = monthSoFarUsd / threshold.monthlyUsdLimit;
  if (pct >= 1) {
    return threshold.blockAtLimit
      ? { kind: "block", usedUsd: monthSoFarUsd, limitUsd: threshold.monthlyUsdLimit }
      : { kind: "warn", usedUsd: monthSoFarUsd, limitUsd: threshold.monthlyUsdLimit, pct };
  }
  if (pct >= 0.8)
    return { kind: "warn", usedUsd: monthSoFarUsd, limitUsd: threshold.monthlyUsdLimit, pct };
  return { kind: "ok" };
}

// S-AIC-011: CSV export. Rust streams rows; we format here so users get
// a stable header order. Excel-compatible: BOM-prefixed UTF-8, CRLF lines.
export function formatUsageCsv(rows: UsageRow[]): string {
  const header =
    "ts,alias,provider,model,action,input_tokens,output_tokens,usd,pricing_version,status";
  const lines = rows.map((r) =>
    [
      new Date(r.ts).toISOString(),
      r.alias,
      r.provider,
      r.model,
      r.actionId,
      r.inputTokens,
      r.outputTokens,
      r.usd.toFixed(6),
      r.pricingVersion,
      r.status,
    ]
      .map(csvEscape)
      .join(","),
  );
  return `﻿${header}\r\n${lines.join("\r\n")}\r\n`;
}

function csvEscape(value: string | number): string {
  const s = String(value);
  if (/[",\r\n]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

// S-AIC-012: user-triggered usage reset. Confirmation lives at the call
// site — the UI surfaces a "this is irreversible" dialog before we send
// the IPC. The Rust side preserves the rows in a `purged_usage` archive
// table for 30 days in case the user reset by accident.
export async function resetUsage(): Promise<void> {
  await invoke("ai_usage_reset");
}
