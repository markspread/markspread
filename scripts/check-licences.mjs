#!/usr/bin/env node
// S-SE-030: licence compliance check.
//
// Walks the resolved pnpm dependency tree and fails the build when any
// non-allow-listed licence appears. We intentionally allow-list a tight
// set of permissive licences so an inadvertent GPL transitive dep
// surfaces in CI before it ships.

import { execSync } from "node:child_process";

const ALLOW = new Set([
  "MIT", "Apache-2.0", "BSD-2-Clause", "BSD-3-Clause", "ISC", "MPL-2.0",
  "0BSD", "Unlicense", "CC0-1.0", "CC-BY-3.0", "CC-BY-4.0",
  "Python-2.0", "BlueOak-1.0.0",
  // SIL Open Font License — the @fontsource* packages ship fonts under it.
  "OFL-1.1",
]);

// Packages whose published metadata omits a `license` field (pnpm reports
// "Unknown") but whose bundled LICENSE file confirms a permissive licence.
const OVERRIDES = new Map([
  ["khroma", "MIT"], // LICENSE file: MIT © Fabio Spampinato, Andrew Maney
]);

// True when an SPDX expression is satisfied by the allow-list: a bare or
// parenthesised `A OR B` passes if any clause is allowed; `A AND B`
// requires every clause.
function isAllowedExpression(licence) {
  const inner = licence.replace(/^\(/, "").replace(/\)$/, "").trim();
  if (ALLOW.has(inner)) return true;
  if (/\sOR\s/i.test(inner)) {
    return inner.split(/\s+OR\s+/i).some((c) => ALLOW.has(c.trim()));
  }
  if (/\sAND\s/i.test(inner)) {
    return inner.split(/\s+AND\s+/i).every((c) => ALLOW.has(c.trim()));
  }
  return false;
}

let licensesJson;
try {
  licensesJson = execSync("pnpm licenses list --prod --json", { encoding: "utf8" });
} catch (e) {
  console.error("failed to run `pnpm licenses list`:", e.message);
  process.exit(2);
}

const groups = JSON.parse(licensesJson);
const failures = [];
for (const [licence, packages] of Object.entries(groups)) {
  if (isAllowedExpression(licence)) continue;
  for (const pkg of packages) {
    const override = OVERRIDES.get(pkg.name);
    if (override && ALLOW.has(override)) continue;
    failures.push({ licence, name: pkg.name, version: pkg.versions?.[0] });
  }
}

if (failures.length > 0) {
  console.error("Disallowed licences detected:");
  for (const f of failures) console.error(`  ${f.name}@${f.version} — ${f.licence}`);
  process.exit(1);
}
console.log(`ok — all ${Object.values(groups).reduce((a, p) => a + p.length, 0)} packages on the allow-list.`);
