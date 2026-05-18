#!/usr/bin/env node
// S-SE-005: fail CI when a known-shape secret slips into a tracked file.
//
// Limited scope: we look for a handful of vendor-specific shapes that
// appear in committed code only by mistake (AWS, GitHub, OpenAI,
// Anthropic, Stripe). The list mirrors the runtime scanner so a value
// that the AI context would mask is also a value the repo will refuse
// to ship.
//
// Test fixtures and the README are allow-listed via // ms:allow-secret
// comment trailers per file. Adding new entries is intentional — the
// reviewer must SAW the pragma — so accidentally allow-listing a
// real key requires effort.

import { readFileSync } from "node:fs";
import { execSync } from "node:child_process";

const PATTERNS = [
  { id: "aws-akia",      re: /\bAKIA[0-9A-Z]{16}\b/g },
  { id: "github-token",  re: /\bghp_[A-Za-z0-9]{36}\b/g },
  { id: "github-fg",     re: /\bgithub_pat_[A-Za-z0-9_]{82}\b/g },
  { id: "openai-key",    re: /\bsk-[A-Za-z0-9]{20,}\b/g },
  { id: "anthropic-key", re: /\bsk-ant-[A-Za-z0-9-]{40,}\b/g },
  { id: "stripe-live",   re: /\bsk_live_[0-9A-Za-z]{24,}\b/g },
  { id: "google-api",    re: /\bAIza[0-9A-Za-z_-]{35}\b/g },
];

const ALLOW_TAG = "ms:allow-secret";

const tracked = execSync("git ls-files", { encoding: "utf8" })
  .split("\n")
  .filter(Boolean)
  // Skip binaries — `git grep -I` semantics, but we walk file-by-file so
  // we can map a finding back to a file path.
  .filter((p) => !/\.(png|jpe?g|gif|webp|ico|woff2?|ttf|otf|pdf|zip|gz|tar|wasm)$/i.test(p));

let failed = 0;
for (const file of tracked) {
  let body;
  try { body = readFileSync(file, "utf8"); } catch { continue; }
  if (body.includes(ALLOW_TAG)) continue;
  for (const p of PATTERNS) {
    p.re.lastIndex = 0;
    let m;
    while ((m = p.re.exec(body))) {
      const line = body.slice(0, m.index).split("\n").length;
      console.error(`${file}:${line} matches ${p.id}`);
      failed += 1;
    }
  }
}

if (failed > 0) {
  console.error(`\nfound ${failed} potential plaintext secret(s) — add // ${ALLOW_TAG} on lines that are intentional fixtures.`);
  process.exit(1);
} else {
  console.log("ok — no plaintext secrets in tracked files.");
}
