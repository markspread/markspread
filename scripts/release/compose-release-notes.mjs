// S-CI-019: compose release notes for the GitHub Release page.
//
// Sources of truth:
//   1. CHANGELOG.md       — written by `changesets/action` when the
//                           Version Packages PR merges. We extract the
//                           section for this tag.
//   2. SECURITY-INDEX.md  — list of CVE references the team curates;
//                           if any entry has the current tag, we
//                           prepend a "Security" callout.
//   3. SBOM-DELTA.md      — auto-emitted next to the SBOM artifact;
//                           lists added/removed dependencies.
//
// We deliberately don't generate notes from commit titles — changesets
// already capture the why-it-matters, and synthesised notes from raw
// commits read like noise.

import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { argv, exit } from "node:process";

function arg(flag, fallback) {
  const i = argv.indexOf(flag);
  if (i === -1) return fallback;
  return argv[i + 1];
}

const tag = arg("--tag");
const out = arg("--out", "release-notes.md");
if (!tag) {
  console.error("--tag is required");
  exit(1);
}
const versionHeading = `## ${tag.replace(/^v/, "")}`;

function extractTagSection(path, heading) {
  if (!existsSync(path)) return "";
  const src = readFileSync(path, "utf8");
  const lines = src.split("\n");
  const start = lines.findIndex((l) => l.trim().startsWith(heading));
  if (start === -1) return "";
  const end = lines.slice(start + 1).findIndex((l) => l.startsWith("## ")) + start + 1;
  const slice = end > start ? lines.slice(start + 1, end) : lines.slice(start + 1);
  return slice.join("\n").trim();
}

const changes = extractTagSection("CHANGELOG.md", versionHeading);
const sbomDiff = existsSync("dist/SBOM-DELTA.md")
  ? readFileSync("dist/SBOM-DELTA.md", "utf8").trim()
  : "";

let security = "";
if (existsSync("SECURITY-INDEX.md")) {
  const src = readFileSync("SECURITY-INDEX.md", "utf8");
  const block = src.split(/^## /m).find((b) => b.startsWith(tag.replace(/^v/, "")));
  if (block) security = "> ⚠️ **Security release** — see [advisory](#security) below.\n";
}

let body = "";
if (security) body += `${security}\n`;
body += changes || "_No changeset entries — this release is automation-only._\n";
if (sbomDiff) body += `\n## Dependency changes\n\n${sbomDiff}\n`;

body += "\n## Verifying the download\n\n";
body += "Each release ships a detached `SHA256SUMS.asc` signed by the Markspread release key";
body += " (fingerprint: `see https://markspread.app/security`).\n\n";
body += "```sh\ngpg --verify SHA256SUMS.asc SHA256SUMS\nshasum -a 256 -c SHA256SUMS\n```\n";

writeFileSync(out, body);
console.error(`Wrote ${out} (${body.length} chars)`);
