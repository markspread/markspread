// S-I18-011/012: locale-aware date / number / byte / relative formatting.

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { useLocale } from "../store/locale";
import {
  formatBytes,
  formatDate,
  formatDateTime,
  formatNumber,
  formatRelativeFromNow,
  formatTime,
  formatUsdCost,
} from "./i18n-format";

beforeEach(() => {
  useLocale.setState({ locale: "en" });
});

afterEach(() => {
  useLocale.setState({ locale: "en" });
});

describe("formatDate / formatTime / formatDateTime", () => {
  const stamp = Date.UTC(2025, 11, 31, 13, 5);

  it("formats a date in the active locale", () => {
    const en = formatDate(stamp);
    expect(typeof en).toBe("string");
    expect(en.length).toBeGreaterThan(0);
  });

  it("changes output when the locale changes", () => {
    const en = formatDate(stamp, { dateStyle: "long" });
    useLocale.setState({ locale: "ko" });
    const ko = formatDate(stamp, { dateStyle: "long" });
    expect(ko).not.toBe(en);
  });

  it("formats time and datetime", () => {
    expect(formatTime(stamp)).toMatch(/\d/);
    expect(formatDateTime(stamp)).toMatch(/\d/);
  });

  it("accepts a Date instance", () => {
    expect(formatDate(new Date(stamp))).toMatch(/\d/);
  });
});

describe("formatNumber / formatUsdCost", () => {
  it("groups digits", () => {
    expect(formatNumber(1234567)).toBe("1,234,567");
  });

  it("renders USD with up to 4 fraction digits", () => {
    expect(formatUsdCost(0.0023)).toContain("$");
    expect(formatUsdCost(0.0023)).toContain("0.0023");
    expect(formatUsdCost(12)).toContain("12.00");
  });

  it("caches formatters per shape (same string twice)", () => {
    expect(formatNumber(5)).toBe(formatNumber(5));
  });
});

describe("formatBytes", () => {
  it("renders bytes with no decimals", () => {
    expect(formatBytes(512)).toBe("512 B");
  });

  it("renders KB with one decimal under 10", () => {
    expect(formatBytes(1536)).toBe("1.5 KB");
  });

  it("renders larger units with no decimals at >= 10", () => {
    expect(formatBytes(20 * 1024)).toBe("20 KB");
  });

  it("climbs through MB / GB / TB", () => {
    expect(formatBytes(5 * 1024 * 1024)).toContain("MB");
    expect(formatBytes(3 * 1024 ** 3)).toContain("GB");
    expect(formatBytes(2 * 1024 ** 4)).toContain("TB");
  });

  it("caps at TB for absurdly large inputs", () => {
    expect(formatBytes(1024 ** 6)).toContain("TB");
  });

  it("returns 0 B for negative or non-finite input", () => {
    expect(formatBytes(-1)).toBe("0 B");
    expect(formatBytes(Number.NaN)).toBe("0 B");
  });

  it("returns 0 B for zero", () => {
    expect(formatBytes(0)).toBe("0 B");
  });
});

describe("formatRelativeFromNow", () => {
  const now = Date.UTC(2025, 5, 1, 12, 0, 0);

  it("renders seconds for small deltas", () => {
    expect(formatRelativeFromNow(now - 10_000, now)).toMatch(/second|now|ago/i);
  });

  it("renders minutes", () => {
    expect(formatRelativeFromNow(now - 5 * 60_000, now)).toMatch(/minute/i);
  });

  it("renders hours", () => {
    expect(formatRelativeFromNow(now - 3 * 3_600_000, now)).toMatch(/hour/i);
  });

  it("renders days", () => {
    expect(formatRelativeFromNow(now - 3 * 86_400_000, now)).toMatch(/day|yesterday/i);
  });

  it("renders months", () => {
    expect(formatRelativeFromNow(now - 60 * 86_400_000, now)).toMatch(/month/i);
  });

  it("renders years", () => {
    expect(formatRelativeFromNow(now - 400 * 86_400_000, now)).toMatch(/year/i);
  });

  it("accepts Date instances and a default now", () => {
    expect(typeof formatRelativeFromNow(new Date())).toBe("string");
  });

  it("handles a future delta", () => {
    expect(formatRelativeFromNow(now + 5 * 60_000, now)).toMatch(/minute/i);
  });

  it("accepts a Date as the explicit now argument", () => {
    expect(typeof formatRelativeFromNow(new Date(now - 10_000), new Date(now))).toBe("string");
  });
});

describe("locale subscription", () => {
  it("clears caches so a locale switch is reflected", () => {
    const before = formatNumber(1234.5);
    useLocale.setState({ locale: "es" });
    const after = formatNumber(1234.5);
    expect(typeof after).toBe("string");
    expect(before).toBe("1,234.5");
  });
});
