// S-PF-002: enforce cold-start budgets.
//
// Reads the jsonl report emitted by `cold-start-probe.mjs`, pulls the
// trailing summary line, and fails the build when p50 or p95 exceeds
// the budget for the current platform.
//
// Usage:  node scripts/perf/check-budgets.mjs perf-stats.jsonl
//
// Budgets can be overridden per-run via P50_BUDGET_MS / P95_BUDGET_MS;
// otherwise the per-platform defaults below apply. The debug binary is
// slower than a release bundle, so these are deliberately looser than
// the release budgets in perf-cold-start.yml.

import { readFileSync } from "node:fs";

// Samples come from `cold-start-probe.mjs` after an untimed warmup, so
// each one represents a second-launch user experience (caches primed).
// Budgets stay tight enough to flag real regressions; the debug binary
// runs ~2× the release bundle so these are looser than the release
// budgets in perf-cold-start.yml.
const DEFAULT_BUDGETS = {
  darwin: { p50: 800, p95: 1200 },
  linux: { p50: 1000, p95: 1500 },
  win32: { p50: 1500, p95: 2200 },
};

const reportPath = process.argv[2];
if (!reportPath) {
  console.error("::error::usage: check-budgets.mjs <report.jsonl>");
  process.exit(1);
}

let lines;
try {
  lines = readFileSync(reportPath, "utf8")
    .split("\n")
    .filter((l) => l.trim());
} catch (err) {
  console.error(`::error::cannot read report ${reportPath}: ${err.message}`);
  process.exit(1);
}

const records = lines.map((l) => JSON.parse(l));
const summary = records.find((r) => r.summary);
if (!summary) {
  console.error("::error::report has no summary line");
  process.exit(1);
}

const platform = process.platform;
const fallback = DEFAULT_BUDGETS[platform] ?? { p50: 2000, p95: 2800 };
const p50Budget = Number(process.env.P50_BUDGET_MS) || fallback.p50;
const p95Budget = Number(process.env.P95_BUDGET_MS) || fallback.p95;

const p50Over = summary.p50 > p50Budget;
const p95Over = summary.p95 > p95Budget;

console.log(`platform: ${platform}`);
console.log(`p50: ${summary.p50}ms / budget ${p50Budget}ms ${p50Over ? "FAIL" : "ok"}`);
console.log(`p95: ${summary.p95}ms / budget ${p95Budget}ms ${p95Over ? "FAIL" : "ok"}`);

if (process.env.GITHUB_STEP_SUMMARY) {
  const { appendFileSync } = await import("node:fs");
  appendFileSync(
    process.env.GITHUB_STEP_SUMMARY,
    `## Cold start (${platform})\n\np50: ${summary.p50}ms / budget ${p50Budget}ms\n\np95: ${summary.p95}ms / budget ${p95Budget}ms\n`,
  );
}

if (p50Over || p95Over) {
  console.error("::error::cold-start budget exceeded");
  process.exit(1);
}
