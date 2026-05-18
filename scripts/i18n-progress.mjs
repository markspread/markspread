#!/usr/bin/env node
// S-I18-015: per-locale translation progress report.
//
// Compares each locale bundle to en (the canonical key set) and prints a
// Markdown table plus a JSON summary. CI uploads the JSON as a workflow
// artifact so reviewers can trend coverage over time without manual audits.

import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const repoRoot = join(__filename, "..", "..");
const localesDir = join(repoRoot, "src", "locales");

const LOCALES = ["en", "ko", "ja", "zh", "es"];

function flatten(obj, prefix = "") {
  const out = {};
  for (const [k, v] of Object.entries(obj)) {
    const next = prefix ? `${prefix}.${k}` : k;
    if (v && typeof v === "object" && !Array.isArray(v)) {
      Object.assign(out, flatten(v, next));
    } else {
      out[next] = v;
    }
  }
  return out;
}

const en = flatten(JSON.parse(readFileSync(join(localesDir, "en.json"), "utf8")));
const enKeys = Object.keys(en);
const enTotal = enKeys.length;

const report = { generatedAt: new Date().toISOString(), totalKeys: enTotal, locales: {} };

for (const lng of LOCALES) {
  let translated = 0;
  let missing = [];
  let identical = 0;
  if (lng === "en") {
    translated = enTotal;
  } else {
    const flat = flatten(JSON.parse(readFileSync(join(localesDir, `${lng}.json`), "utf8")));
    for (const key of enKeys) {
      const value = flat[key];
      if (typeof value !== "string" || value.length === 0) {
        missing.push(key);
      } else {
        translated += 1;
        if (value === en[key]) identical += 1;
      }
    }
  }
  const pct = enTotal === 0 ? 100 : Math.round((translated / enTotal) * 1000) / 10;
  report.locales[lng] = { translated, missing: missing.length, identicalToEn: identical, percent: pct };
}

const args = process.argv.slice(2);
const outIdx = args.indexOf("--out");
if (outIdx >= 0 && args[outIdx + 1]) {
  writeFileSync(args[outIdx + 1], JSON.stringify(report, null, 2));
}

const rows = LOCALES.map((lng) => {
  const r = report.locales[lng];
  return `| ${lng} | ${r.translated} / ${enTotal} | ${r.percent.toFixed(1)}% | ${r.missing} | ${r.identicalToEn} |`;
});

const md = [
  `# i18n progress (${report.generatedAt})`,
  "",
  `Canonical key count (en): **${enTotal}**`,
  "",
  "| locale | translated | percent | missing | identical-to-en |",
  "|---|---|---|---|---|",
  ...rows,
  "",
].join("\n");

console.log(md);
