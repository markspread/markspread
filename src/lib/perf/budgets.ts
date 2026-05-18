// S-PF-001..019: performance budgets + measurement helpers.
//
// We treat performance as a contract: each metric has a budget and a
// CI-enforced ceiling. The numbers below codify what users actually
// feel — cold-start under 500ms is the boundary between "boots" and
// "I feel it loading"; 16ms keystroke latency is one frame at 60Hz; 80MB
// idle RAM keeps Markspread off the radar of the OS memory pressure
// notifier.
//
// The renderer-side measurement uses the User Timing API + a small
// sampler that pushes results to the Rust side, which writes a daily
// `perf-stats.jsonl`. CI compares the stats against the budget table
// and fails when a regression exceeds the threshold.

export interface PerfBudget {
  id: string;
  description: string;
  /** Target value users feel as "good". */
  target: number;
  /** Hard ceiling — exceeding this fails CI. */
  ceiling: number;
  /** Unit, for display. */
  unit: "ms" | "MB" | "files" | "fps";
  /** Source of the measurement — drives which probe collects it. */
  source: "renderer" | "rust" | "bundle" | "ci-script";
}

export const PERF_BUDGETS: PerfBudget[] = [
  // S-PF-001..002: cold start.
  { id: "cold-start.macos-aarch64", description: "Cold start on Apple Silicon", target: 350, ceiling: 500, unit: "ms", source: "renderer" },
  { id: "cold-start.macos-x86",     description: "Cold start on Intel Mac",      target: 600, ceiling: 900, unit: "ms", source: "renderer" },
  { id: "cold-start.windows",       description: "Cold start on Windows 11 x86_64", target: 600, ceiling: 1000, unit: "ms", source: "renderer" },
  { id: "cold-start.linux",         description: "Cold start on Ubuntu 22.04",     target: 500, ceiling: 800, unit: "ms", source: "renderer" },

  // S-PF-003..005: file open latency.
  { id: "open-1mb",   description: "Open 1MB markdown file",  target: 60,  ceiling: 100, unit: "ms", source: "renderer" },
  { id: "open-10mb",  description: "Open 10MB markdown file", target: 300, ceiling: 500, unit: "ms", source: "renderer" },
  { id: "open-50mb",  description: "Open 50MB markdown file (partial load + warning)", target: 1000, ceiling: 2000, unit: "ms", source: "renderer" },

  // S-PF-006..008: workspace indexing.
  { id: "index.100mb-files",  description: "Index 100MB workspace",    target: 3500,  ceiling: 5000,   unit: "ms", source: "rust" },
  { id: "index.10k-files",    description: "Index 10,000 files",       target: 20000, ceiling: 30000,  unit: "ms", source: "rust" },
  { id: "index.100k-files",   description: "Index 100,000 files",      target: 200000, ceiling: 300000, unit: "ms", source: "rust" },

  // S-PF-009 / S-PF-010: memory.
  { id: "rss.idle",                description: "Idle resident memory",            target: 60,  ceiling: 80,  unit: "MB", source: "rust" },
  { id: "rss.workspace-10k-files", description: "Resident memory with 10K-file workspace open", target: 200, ceiling: 250, unit: "MB", source: "rust" },

  // S-PF-011 / S-PF-012: bundle size.
  { id: "bundle.dmg", description: "macOS .dmg installer size", target: 12, ceiling: 15, unit: "MB", source: "ci-script" },
  { id: "bundle.msi", description: "Windows .msi installer size", target: 12, ceiling: 15, unit: "MB", source: "ci-script" },

  // S-PF-013 / S-PF-015 / S-PF-016: editor responsiveness.
  { id: "input.keystroke", description: "Time from keypress to caret move", target: 8,  ceiling: 16, unit: "ms", source: "renderer" },
  { id: "search.10k-files", description: "Workspace search across 10K files", target: 600, ceiling: 1000, unit: "ms", source: "rust" },
  { id: "completion.local",  description: "Autocomplete first suggestion latency", target: 25,  ceiling: 50,  unit: "ms", source: "renderer" },
  { id: "preview.debounce",  description: "Markdown preview debounce window",       target: 80,  ceiling: 120, unit: "ms", source: "renderer" },

  // S-ESP-013: split-pane regression coverage. The 1-pane numbers
  // double as the F4-on baseline; 2- and 4-pane budgets allow some
  // headroom for the extra CodeMirror instances but the keystroke
  // ceiling stays at one 60Hz frame — split should not feel slower.
  { id: "panes.1.input-keystroke-p95", description: "Keystroke p95 with 1 pane",  target: 10, ceiling: 16, unit: "ms", source: "renderer" },
  { id: "panes.2.input-keystroke-p95", description: "Keystroke p95 with 2 panes", target: 12, ceiling: 16, unit: "ms", source: "renderer" },
  { id: "panes.4.input-keystroke-p95", description: "Keystroke p95 with 4 panes", target: 14, ceiling: 16, unit: "ms", source: "renderer" },
  { id: "panes.1.rss-idle", description: "Idle resident memory with 1 pane",  target: 60,  ceiling: 80,  unit: "MB", source: "rust" },
  { id: "panes.2.rss-idle", description: "Idle resident memory with 2 panes", target: 75,  ceiling: 100, unit: "MB", source: "rust" },
  { id: "panes.4.rss-idle", description: "Idle resident memory with 4 panes", target: 110, ceiling: 150, unit: "MB", source: "rust" },
  { id: "panes.1.cold-start", description: "Cold start with 1 pane restored",  target: 350, ceiling: 500,  unit: "ms", source: "renderer" },
  { id: "panes.2.cold-start", description: "Cold start with 2 panes restored", target: 420, ceiling: 650,  unit: "ms", source: "renderer" },
  { id: "panes.4.cold-start", description: "Cold start with 4 panes restored", target: 550, ceiling: 900,  unit: "ms", source: "renderer" },
];

// Tag a perf-mark with the budget id so the sampler can correlate.
export function recordSample(budgetId: string, value: number): void {
  if (typeof performance === "undefined" || typeof performance.mark !== "function") return;
  performance.mark(`ms-perf:${budgetId}:${value}`);
}

/**
 * S-ESP-013: nearest-rank p95 over a finite sample. Used by the
 * split-pane perf harness to derive `panes.N.input-keystroke-p95`
 * before pushing the value through `recordSample`. Returns NaN for an
 * empty input — callers should guard.
 */
export function percentile(samples: readonly number[], p: number): number {
  if (samples.length === 0) return Number.NaN;
  const sorted = [...samples].sort((a, b) => a - b);
  const rank = Math.ceil((p / 100) * sorted.length);
  const idx = Math.min(sorted.length - 1, Math.max(0, rank - 1));
  return sorted[idx]!;
}

// CI script reads the `perf-stats.jsonl` written by the Rust sampler
// and compares each entry against the budgets above. Returns a list of
// regressions; an empty list means "ok".
export interface PerfSample {
  budgetId: string;
  value: number;
  /** Iso timestamp from the run. */
  ts: string;
  /** CI run identifier so a regression links back to the failing run. */
  runId: string;
}

export interface Regression {
  budgetId: string;
  value: number;
  ceiling: number;
  unit: PerfBudget["unit"];
}

export function findRegressions(samples: PerfSample[]): Regression[] {
  const out: Regression[] = [];
  for (const s of samples) {
    const budget = PERF_BUDGETS.find((b) => b.id === s.budgetId);
    if (!budget) continue;
    if (s.value > budget.ceiling) out.push({ budgetId: s.budgetId, value: s.value, ceiling: budget.ceiling, unit: budget.unit });
  }
  return out;
}

// S-PF-017: a tiny in-process leak sentinel. Long-running tests grab a
// baseline RSS and keep poking at it; if the value grows monotonically
// past `growthCeilingMb` over `windowMs`, the sentinel fails.
export interface LeakSentinelConfig {
  windowMs: number;
  growthCeilingMb: number;
  sampleIntervalMs: number;
}

export const DEFAULT_LEAK_SENTINEL: LeakSentinelConfig = {
  windowMs: 5 * 60 * 1000,
  growthCeilingMb: 30,
  sampleIntervalMs: 5_000,
};
