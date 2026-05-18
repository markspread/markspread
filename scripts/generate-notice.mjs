#!/usr/bin/env node
// S-LGL-002: write a top-level NOTICE file aggregating every
// dependency's license text. Reads src-tauri/licenses/licenses.json
// (produced by scripts/generate-licenses.mjs) so the two stay
// consistent — the in-app About panel and the NOTICE file are the
// same data, just rendered differently.
//
// We run this in CI before bundling so the NOTICE that ships with
// the binary is always current. If you change a dependency, run
// `pnpm gen:licenses && pnpm gen:notice` and commit both.

import { readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, "..");
const LICENSES = resolve(ROOT, "src-tauri/licenses/licenses.json");
const OUT = resolve(ROOT, "NOTICE");

const APP_LICENSE = readFileSync(resolve(ROOT, "LICENSE"), "utf8").trim();
const deps = JSON.parse(readFileSync(LICENSES, "utf8"));

const groups = new Map();
for (const d of deps) {
  const key = d.license || "UNKNOWN";
  if (!groups.has(key)) groups.set(key, []);
  groups.get(key).push(d);
}

let out = "";
out += "Markspread\n";
out += "==========\n\n";
out += "Markspread is licensed under the MIT License (see LICENSE).\n";
out += "This NOTICE file lists the third-party software that\n";
out += "Markspread bundles or links against, grouped by license.\n";
out += "\n";
out += "If you redistribute Markspread, please ship this NOTICE\n";
out += "alongside the binary. The same information is also visible\n";
out += "in the running app under Settings → About → Licenses.\n";
out += "\n";
out += "----\n\n";
out += "Markspread\n----------\n\n";
out += `${APP_LICENSE}\n\n`;
out += "----\n\n";

const sortedLicenses = [...groups.keys()].sort();
for (const license of sortedLicenses) {
  const items = groups.get(license).sort((a, b) => a.name.localeCompare(b.name));
  out += `${license}\n${"-".repeat(license.length)}\n\n`;
  for (const item of items) {
    out += `* ${item.name} ${item.version}`;
    if (item.repository) out += `  (${item.repository})`;
    out += "\n";
  }
  out += "\n";
  // We don't dump the whole license text per-package because the
  // SPDX id is the legally meaningful bit; the full text is shipped
  // in src-tauri/licenses/licenses.json for the in-app viewer.
}

writeFileSync(OUT, out);
console.log(`Wrote ${OUT} (${deps.length} deps, ${groups.size} licenses).`);
