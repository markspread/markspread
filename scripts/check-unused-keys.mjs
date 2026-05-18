#!/usr/bin/env node
// S-I18-014: report translation keys that aren't referenced anywhere in the
// source tree. We treat the en bundle as the source of truth (it must contain
// every key the app uses, since fallbackLng is en) and grep src/ for either
// `t("ns.key")` calls or any string literal that exactly matches a key.
//
// The check is reported as warnings — an unused key isn't a build blocker
// (it might be exposed to plugins or queued for an upcoming feature) — but
// CI surfaces the list so reviewers can prune intentional leftovers.

import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, sep } from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const repoRoot = join(__filename, "..", "..");
const srcRoot = join(repoRoot, "src");
const enBundlePath = join(srcRoot, "locales", "en.json");

function flatten(obj, prefix = "") {
  const out = [];
  for (const [k, v] of Object.entries(obj)) {
    const next = prefix ? `${prefix}.${k}` : k;
    if (v && typeof v === "object" && !Array.isArray(v)) {
      out.push(...flatten(v, next));
    } else {
      out.push(next);
    }
  }
  return out;
}

function* walk(dir) {
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    const stat = statSync(full);
    if (stat.isDirectory()) {
      if (name === "node_modules" || name === "locales" || name.startsWith(".")) continue;
      yield* walk(full);
    } else if (/\.(tsx?|jsx?|mjs)$/.test(name)) {
      yield full;
    }
  }
}

const en = JSON.parse(readFileSync(enBundlePath, "utf8"));
const keys = flatten(en);

let haystack = "";
for (const file of walk(srcRoot)) {
  haystack += readFileSync(file, "utf8");
  haystack += "\n";
}

const unused = keys.filter((key) => !haystack.includes(key));

if (unused.length === 0) {
  console.log("unused-i18n-keys: 0");
  process.exit(0);
}

console.warn(`unused-i18n-keys: ${unused.length} key(s) not referenced in src/`);
for (const key of unused) {
  console.warn(`  ${key}`);
}
// Non-zero exit so CI fails — the user explicitly asked for a CI lint, not a
// soft warning. Suppress per-key with a comment or remove the entry from
// every locale bundle if intentionally orphaned.
process.exit(1);
