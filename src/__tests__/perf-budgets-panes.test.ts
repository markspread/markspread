// S-ESP-013: budgets + regression detection for the split-pane scenarios.

import { describe, expect, it, vi } from "vitest";
import {
  PERF_BUDGETS,
  type PerfSample,
  findRegressions,
  percentile,
  recordSample,
} from "../lib/perf/budgets";

const RUN = { ts: "2026-05-13T00:00:00Z", runId: "test-run" };

function sample(budgetId: string, value: number): PerfSample {
  return { budgetId, value, ts: RUN.ts, runId: RUN.runId };
}

describe("split-pane perf budgets", () => {
  it("registers 1/2/4 pane keystroke, memory, and cold-start budgets", () => {
    const ids = PERF_BUDGETS.map((b) => b.id);
    for (const n of [1, 2, 4]) {
      expect(ids).toContain(`panes.${n}.input-keystroke-p95`);
      expect(ids).toContain(`panes.${n}.rss-idle`);
      expect(ids).toContain(`panes.${n}.cold-start`);
    }
  });

  it("keystroke ceiling stays at one 60Hz frame across pane counts", () => {
    for (const n of [1, 2, 4]) {
      const budget = PERF_BUDGETS.find((b) => b.id === `panes.${n}.input-keystroke-p95`);
      if (!budget) throw new Error(`expected budget for ${n} panes`);
      expect(budget.ceiling).toBe(16);
    }
  });

  it("flags a 2-pane keystroke regression that crosses the 16ms ceiling", () => {
    const regs = findRegressions([
      sample("panes.2.input-keystroke-p95", 18),
      sample("panes.4.input-keystroke-p95", 15),
    ]);
    expect(regs.map((r) => r.budgetId)).toEqual(["panes.2.input-keystroke-p95"]);
    expect(regs[0]?.ceiling).toBe(16);
  });

  it("ignores samples whose budget id is unknown", () => {
    const regs = findRegressions([sample("nope.unknown.id", 9999)]);
    expect(regs).toEqual([]);
  });

  it("passes when all multi-pane samples are within budget", () => {
    const regs = findRegressions([
      sample("panes.1.input-keystroke-p95", 8),
      sample("panes.2.input-keystroke-p95", 12),
      sample("panes.4.input-keystroke-p95", 15),
      sample("panes.2.rss-idle", 90),
      sample("panes.4.cold-start", 700),
    ]);
    expect(regs).toEqual([]);
  });
});

describe("percentile helper", () => {
  it("computes p95 with nearest-rank", () => {
    // 20 samples: 1..20 → p95 → index ceil(0.95 * 20) - 1 = 18 → value 19.
    const samples = Array.from({ length: 20 }, (_, i) => i + 1);
    expect(percentile(samples, 95)).toBe(19);
  });

  it("handles unsorted input", () => {
    expect(percentile([5, 1, 3, 2, 4], 50)).toBe(3);
  });

  it("returns NaN for an empty list", () => {
    expect(Number.isNaN(percentile([], 95))).toBe(true);
  });
});

describe("recordSample", () => {
  it("emits a performance.mark tagged with the budget id and value", () => {
    const markSpy = vi.spyOn(performance, "mark").mockImplementation(() => ({
      name: "",
      duration: 0,
      startTime: 0,
      entryType: "mark",
      detail: null,
      toJSON: () => ({}),
    }));
    try {
      recordSample("panes.2.input-keystroke-p95", 14);
      expect(markSpy).toHaveBeenCalledWith("ms-perf:panes.2.input-keystroke-p95:14");
    } finally {
      markSpy.mockRestore();
    }
  });

  it("is a no-op when performance.mark is unavailable", () => {
    const original = performance.mark;
    (performance as { mark?: unknown }).mark = undefined;
    try {
      expect(() => recordSample("anything", 1)).not.toThrow();
    } finally {
      (performance as { mark?: unknown }).mark = original;
    }
  });
});
