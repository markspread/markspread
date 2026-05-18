// S-CI-023: enforce SHA-pinned third-party GitHub Actions.
//
// Why: a `uses: someorg/some-action@v3` reference resolves to whatever
// commit the tag points at *right now*. An attacker who compromises
// the action repo can move the tag to a malicious commit and every
// workflow re-runs against it. Pinning to a 40-char commit SHA closes
// that window — the action repo can publish a new release, but our
// CI keeps running the audited code until we explicitly bump.
//
// Renovate's `helpers:pinGitHubActionDigests` preset opens PRs that do
// the bumping for us; this script is the gate that blocks regressions
// while a human reviewer eyeballs the diff.
//
// Allow-list: actions inside `actions/` (GitHub-owned) and
// `./.github/actions/setup` (our own composite action) may use a
// version tag — they're operationally trusted and bumping them weekly
// would be all-noise.

import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

const ROOT = ".github/workflows";
const COMPOSITE_ACTIONS_ROOT = ".github/actions";

const TRUSTED_PREFIXES = [
  "actions/",          // GitHub
  "./",                // our own composite actions
];

const SHA_RE = /@[0-9a-f]{40}\b/;
const USES_RE = /^\s*-?\s*uses:\s*([^\s#]+)/;

function walk(dir, out = []) {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    const st = statSync(full);
    if (st.isDirectory()) walk(full, out);
    else if (full.endsWith(".yml") || full.endsWith(".yaml")) out.push(full);
  }
  return out;
}

const files = [...walk(ROOT)];
if (statSync(COMPOSITE_ACTIONS_ROOT, { throwIfNoEntry: false })) {
  walk(COMPOSITE_ACTIONS_ROOT, files);
}

const violations = [];
for (const file of files) {
  const lines = readFileSync(file, "utf8").split("\n");
  lines.forEach((line, i) => {
    const m = line.match(USES_RE);
    if (!m) return;
    const ref = m[1];
    if (TRUSTED_PREFIXES.some((p) => ref.startsWith(p))) return;
    if (SHA_RE.test(ref)) return;
    violations.push({ file, line: i + 1, ref });
  });
}

if (violations.length > 0) {
  console.error("Unpinned third-party actions found:\n");
  for (const v of violations) {
    console.error(`  ${v.file}:${v.line}  uses: ${v.ref}`);
  }
  console.error(
    "\nPin to a 40-char commit SHA. Renovate's `helpers:pinGitHubActionDigests` preset will open the bump PRs.\n",
  );
  process.exit(1);
}

console.error(`OK — ${files.length} workflow file(s) scanned, all third-party actions pinned to SHA.`);
