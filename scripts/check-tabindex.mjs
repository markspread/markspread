#!/usr/bin/env node
// S-A11-002: forbid positive `tabIndex` values.
//
// Positive tabindex tries to override the natural document order and reliably
// trips screen-reader users into an unexpected sequence. The contract is:
// `tabIndex={0}` to opt non-interactive elements *into* the tab ring,
// `tabIndex={-1}` to take an interactive element *out*. Anything ≥ 1 is
// rejected so reviewers can see the violation in CI.

import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const repoRoot = join(__filename, "..", "..");
const srcRoot = join(repoRoot, "src");

function* walk(dir) {
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    const stat = statSync(full);
    if (stat.isDirectory()) {
      if (name === "node_modules" || name.startsWith(".")) continue;
      yield* walk(full);
    } else if (/\.(tsx?|jsx?)$/.test(name)) {
      yield full;
    }
  }
}

const violations = [];
for (const file of walk(srcRoot)) {
  const lines = readFileSync(file, "utf8").split(/\r?\n/);
  for (let i = 0; i < lines.length; i += 1) {
    // Match `tabIndex={N}` or `tabindex="N"` where N is a positive integer.
    const m = lines[i].match(/tab[Ii]ndex\s*=\s*[{"]\s*(\d+)/);
    if (m && Number(m[1]) > 0) {
      violations.push({
        file: relative(repoRoot, file).split(sep).join("/"),
        line: i + 1,
        value: m[1],
      });
    }
  }
}

if (violations.length === 0) {
  console.log("tabindex: clean (only 0 / -1 used)");
  process.exit(0);
}

console.error(`tabindex: ${violations.length} positive value(s) found.`);
for (const v of violations) {
  console.error(`  ${v.file}:${v.line}  tabIndex=${v.value}`);
}
process.exit(1);
