// S-PF-019: enforce hard bundle-size ceilings.
//
// Scans the production `dist/` build and fails when the renderer bundle
// crosses a ceiling. We gate on gzipped totals — that is what ships
// over the wire — plus a per-chunk cap so a single fat dependency
// can't sneak in unnoticed.
//
// Usage:  node scripts/perf/check-bundle.mjs

import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { gzipSync } from "node:zlib";

// Ceilings (gzipped bytes). Bump deliberately in the same PR that adds
// the weight, so the diff records the trade-off.
//
// 2026-07 bump (900 kB → 1.8 MB): wiring the baseline-parsing renderers
// into the app (SC-BASE-02/03/05) adds mermaid (~750 kB across its
// per-diagram chunks), KaTeX (~76 kB) and a curated shiki core+grammar
// set (~150 kB). All of it is lazy — first-diagram / first-formula /
// first-code-fence loads — so the boot path and cold-start gates are
// unaffected; this ceiling bounds what a full offline install ships.
const CEILINGS = {
  totalJs: 1800 * 1024,
  totalCss: 80 * 1024,
  largestChunk: 500 * 1024,
};

const distAssets = join(process.cwd(), "dist", "assets");
if (!existsSync(distAssets)) {
  console.error("::error::dist/assets not found — run `pnpm vite build` first");
  process.exit(1);
}

function gzipSize(path) {
  return gzipSync(readFileSync(path)).length;
}

function fmt(bytes) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} kB`;
  return `${(bytes / 1024 / 1024).toFixed(2)} MB`;
}

let totalJs = 0;
let totalCss = 0;
let largest = { name: "", size: 0 };

for (const name of readdirSync(distAssets)) {
  const path = join(distAssets, name);
  if (!statSync(path).isFile()) continue;
  if (name.endsWith(".js")) {
    const gz = gzipSize(path);
    totalJs += gz;
    if (gz > largest.size) largest = { name, size: gz };
  } else if (name.endsWith(".css")) {
    totalCss += gzipSize(path);
  }
}

const checks = [
  { label: "total JS (gzip)", value: totalJs, ceiling: CEILINGS.totalJs },
  { label: "total CSS (gzip)", value: totalCss, ceiling: CEILINGS.totalCss },
  {
    label: `largest chunk (gzip, ${largest.name})`,
    value: largest.size,
    ceiling: CEILINGS.largestChunk,
  },
];

let failed = false;
for (const c of checks) {
  const over = c.value > c.ceiling;
  if (over) failed = true;
  console.log(`${c.label}: ${fmt(c.value)} / ceiling ${fmt(c.ceiling)} ${over ? "FAIL" : "ok"}`);
}

if (process.env.GITHUB_STEP_SUMMARY) {
  const { appendFileSync } = await import("node:fs");
  let md = "## Bundle size (gzip)\n\n| Metric | Size | Ceiling |\n|---|---:|---:|\n";
  for (const c of checks) md += `| ${c.label} | ${fmt(c.value)} | ${fmt(c.ceiling)} |\n`;
  appendFileSync(process.env.GITHUB_STEP_SUMMARY, md);
}

if (failed) {
  console.error("::error::bundle exceeds size ceiling");
  process.exit(1);
}
