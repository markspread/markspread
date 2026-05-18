import { useLocale } from "../store/locale";
import type { SupportedLocale } from "./i18n";

// S-I18-011: locale-aware date / number formatting. All UI surfaces should
// route timestamps and numbers through these helpers instead of `toString()`
// or hand-rolled templates so a Korean user sees `2025년 12월 31일` while a
// Spanish user sees `31 dic 2025`. The Intl.* constructors are expensive, so
// we cache one formatter per (locale × option-shape) pair.

// Maps our internal locale tokens to BCP-47 tags Intl understands. We pick a
// reasonable default region for languages that have multiple — Chinese
// collapses to Simplified for now; the typography layer (S-TY-009) handles
// TC vs SC font selection separately.
const BCP47: Record<SupportedLocale, string> = {
  en: "en-US",
  ko: "ko-KR",
  ja: "ja-JP",
  zh: "zh-CN",
  es: "es-ES",
};

function activeTag(): string {
  return BCP47[useLocale.getState().locale];
}

const dateCache = new Map<string, Intl.DateTimeFormat>();
const numberCache = new Map<string, Intl.NumberFormat>();
const relativeCache = new Map<string, Intl.RelativeTimeFormat>();

function dateFormatter(tag: string, opts: Intl.DateTimeFormatOptions): Intl.DateTimeFormat {
  const key = `${tag}|${JSON.stringify(opts)}`;
  let f = dateCache.get(key);
  if (!f) {
    f = new Intl.DateTimeFormat(tag, opts);
    dateCache.set(key, f);
  }
  return f;
}

function numberFormatter(tag: string, opts: Intl.NumberFormatOptions): Intl.NumberFormat {
  const key = `${tag}|${JSON.stringify(opts)}`;
  let f = numberCache.get(key);
  if (!f) {
    f = new Intl.NumberFormat(tag, opts);
    numberCache.set(key, f);
  }
  return f;
}

function relativeFormatter(
  tag: string,
  opts: Intl.RelativeTimeFormatOptions,
): Intl.RelativeTimeFormat {
  const key = `${tag}|${JSON.stringify(opts)}`;
  let f = relativeCache.get(key);
  if (!f) {
    f = new Intl.RelativeTimeFormat(tag, opts);
    relativeCache.set(key, f);
  }
  return f;
}

export function formatDate(
  value: Date | number,
  opts: Intl.DateTimeFormatOptions = { dateStyle: "medium" },
): string {
  return dateFormatter(activeTag(), opts).format(value);
}

export function formatTime(
  value: Date | number,
  opts: Intl.DateTimeFormatOptions = { timeStyle: "short" },
): string {
  return dateFormatter(activeTag(), opts).format(value);
}

export function formatDateTime(
  value: Date | number,
  opts: Intl.DateTimeFormatOptions = { dateStyle: "medium", timeStyle: "short" },
): string {
  return dateFormatter(activeTag(), opts).format(value);
}

export function formatNumber(value: number, opts: Intl.NumberFormatOptions = {}): string {
  return numberFormatter(activeTag(), opts).format(value);
}

// S-I18-012: AI cost currency. Provider invoices are denominated in USD so
// we always render USD — locale only changes the digit grouping / symbol
// position, not the unit. We allow up to 4 fraction digits so sub-cent token
// costs (e.g. $0.0023) render without rounding to $0.00.
export function formatUsdCost(usd: number): string {
  return formatNumber(usd, {
    style: "currency",
    currency: "USD",
    currencyDisplay: "symbol",
    minimumFractionDigits: 2,
    maximumFractionDigits: 4,
  });
}

// Compact byte sizes — useful for the file-tree size column. We pick the
// largest unit that yields a value ≥ 1 then defer to the locale-aware
// number formatter for the digits.
const BYTE_UNITS = ["B", "KB", "MB", "GB", "TB"] as const;
export function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes < 0) return `${formatNumber(0)} B`;
  let value = bytes;
  let unitIndex = 0;
  while (value >= 1024 && unitIndex < BYTE_UNITS.length - 1) {
    value /= 1024;
    unitIndex += 1;
  }
  const digits = unitIndex === 0 ? 0 : value < 10 ? 1 : 0;
  return `${formatNumber(value, { maximumFractionDigits: digits })} ${BYTE_UNITS[unitIndex]}`;
}

// "5 minutes ago" / "5분 전" — uses the closest unit threshold instead of
// returning a wall-clock string so saved-at indicators read naturally.
export function formatRelativeFromNow(
  value: Date | number,
  now: Date | number = Date.now(),
): string {
  const target = typeof value === "number" ? value : value.getTime();
  const base = typeof now === "number" ? now : now.getTime();
  const deltaMs = target - base;
  const abs = Math.abs(deltaMs);
  const seconds = deltaMs / 1000;
  const f = relativeFormatter(activeTag(), { numeric: "auto" });
  if (abs < 45_000) return f.format(Math.round(seconds), "second");
  if (abs < 45 * 60_000) return f.format(Math.round(seconds / 60), "minute");
  if (abs < 22 * 3_600_000) return f.format(Math.round(seconds / 3600), "hour");
  if (abs < 26 * 86_400_000) return f.format(Math.round(seconds / 86_400), "day");
  if (abs < 11 * 30 * 86_400_000) return f.format(Math.round(seconds / (30 * 86_400)), "month");
  return f.format(Math.round(seconds / (365 * 86_400)), "year");
}

// Reset caches when the locale changes — Intl formatters bind to a tag at
// construction so cached instances would otherwise serve stale strings.
useLocale.subscribe(() => {
  dateCache.clear();
  numberCache.clear();
  relativeCache.clear();
});
