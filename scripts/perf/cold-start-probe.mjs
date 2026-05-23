// S-PF-002: renderer cold-start probe.
//
// Launches the freshly-built debug binary with `--headless-cold-start`
// N times, measuring wall-clock time from spawn until the process
// signals it finished booting (it exits on its own once the cold-start
// path completes; if it lingers we kill it after a timeout).
//
// Usage:  node scripts/perf/cold-start-probe.mjs --runs 5 --report perf-stats.jsonl
//
// Output: one JSON object per line in the report file —
//   {"run":1,"ms":487}
// followed by a trailing summary line —
//   {"summary":true,"runs":5,"p50":491,"p95":absolute,"min":...,"max":...}

import { spawn } from "node:child_process";
import { appendFileSync, existsSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";

function parseArgs(argv) {
  const args = { runs: 5, report: "perf-stats.jsonl" };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--runs") args.runs = Number(argv[++i]);
    else if (argv[i] === "--report") args.report = argv[++i];
  }
  if (!Number.isInteger(args.runs) || args.runs < 1) {
    console.error("::error::invalid --runs value");
    process.exit(1);
  }
  return args;
}

// The binary lives under src-tauri/target — `--target` builds nest it
// one level deeper. Tauri renames the artifact to the productName, but
// a plain `cargo build` leaves the crate name, so accept both.
function findBinary() {
  const isWin = process.platform === "win32";
  const candidates = isWin ? ["Markspread.exe", "markspread.exe"] : ["Markspread", "markspread"];
  const root = join(process.cwd(), "src-tauri", "target");
  if (!existsSync(root)) return null;

  // Search target/debug and target/<triple>/debug.
  const dirs = [join(root, "debug")];
  for (const entry of readdirSync(root)) {
    const triple = join(root, entry, "debug");
    if (existsSync(triple)) dirs.push(triple);
  }
  for (const dir of dirs) {
    for (const name of candidates) {
      const p = join(dir, name);
      if (existsSync(p) && statSync(p).isFile()) return p;
    }
  }
  return null;
}

function measureOnce(bin) {
  return new Promise((resolve) => {
    const start = performance.now();
    const child = spawn(bin, ["--headless-cold-start"], {
      stdio: "ignore",
      env: { ...process.env, MARKSPREAD_AI_MOCK: "1", MARKSPREAD_E2E: "1" },
    });
    let settled = false;
    const finish = () => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(Math.round(performance.now() - start));
    };
    // If the binary stays resident, give it 15s then kill it — the
    // boot path is long done by then.
    const timer = setTimeout(() => {
      child.kill("SIGKILL");
      finish();
    }, 15_000);
    child.on("exit", finish);
    child.on("error", (err) => {
      console.error(`::error::failed to spawn probe binary: ${err.message}`);
      process.exit(1);
    });
  });
}

function percentile(sorted, p) {
  if (sorted.length === 1) return sorted[0];
  const idx = Math.min(sorted.length - 1, Math.max(0, Math.ceil((p / 100) * sorted.length) - 1));
  return sorted[idx];
}

async function main() {
  const { runs, report } = parseArgs(process.argv.slice(2));
  const bin = findBinary();
  if (!bin) {
    console.error(
      "::error::no debug binary found under src-tauri/target — run `pnpm tauri build --debug --no-bundle` first",
    );
    process.exit(1);
  }
  console.log(`probe binary: ${bin}`);

  writeFileSync(report, "");

  // Untimed warmup: primes dyld / page caches so subsequent samples
  // represent a second-launch user experience instead of paying
  // first-after-build I/O on every CI run. Cold-cold launch variance
  // (2x slower on shared runners) dominates p95 from only `runs`
  // samples and obscures real regressions.
  const warmup = await measureOnce(bin);
  console.log(`  warmup (discarded): ${warmup}ms`);

  const samples = [];
  for (let i = 1; i <= runs; i++) {
    const ms = await measureOnce(bin);
    samples.push(ms);
    appendFileSync(report, `${JSON.stringify({ run: i, ms })}\n`);
    console.log(`  run ${i}: ${ms}ms`);
  }

  const sorted = [...samples].sort((a, b) => a - b);
  const summary = {
    summary: true,
    runs,
    p50: percentile(sorted, 50),
    p95: percentile(sorted, 95),
    min: sorted[0],
    max: sorted[sorted.length - 1],
  };
  appendFileSync(report, `${JSON.stringify(summary)}\n`);
  console.log(`p50=${summary.p50}ms p95=${summary.p95}ms (report: ${report})`);
}

main();
