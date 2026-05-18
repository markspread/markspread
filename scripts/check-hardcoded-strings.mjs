#!/usr/bin/env node
// S-I18-013: hard-coded string lint.
//
// Walks src/**/*.{tsx,ts} and flags JSX text nodes / common attribute strings
// that contain Hangul or English sentences (≥2 words). The intent is to push
// new UI through `t()` from the start; pre-existing literal labels are
// allow-listed via a small set of file globs and a `// i18n-allow` line
// comment so devtool-only or generated files don't block CI.
//
// Heuristics, not a full parser — strings inside `t("...")` calls and inside
// import paths are skipped. False positives can be silenced with the inline
// `// i18n-allow` marker on the same line.

import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const repoRoot = join(__filename, "..", "..");
const srcRoot = join(repoRoot, "src");

const ALLOWED_FILE_PATTERNS = [
  /\bsrc[\\/]locales[\\/]/,
  /\.test\.tsx?$/,
  /\.spec\.tsx?$/,
  /\bsrc[\\/]lib[\\/]i18n-format\.ts$/,
];

const HANGUL_PATTERN = /[가-힣]/;
// English sentence: at least two words, kicked off by an uppercase letter so
// "foo" / "bar" / single identifiers don't trigger.
const ENGLISH_SENTENCE = /[A-Z][a-zA-Z]+ [a-zA-Z]+/;

function shouldSkip(filePath) {
  return ALLOWED_FILE_PATTERNS.some((re) => re.test(filePath));
}

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
  if (shouldSkip(file)) continue;
  const text = readFileSync(file, "utf8");
  const lines = text.split(/\r?\n/);
  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i];
    if (line.includes("// i18n-allow")) continue;
    if (/^\s*(import|export)\b/.test(line)) continue;
    // Look only at JSX text positions: between `>` and `<`, plus common
    // attribute values like aria-label / title / placeholder.
    const jsxText = line.match(/>([^<>{}]+)</);
    const attr = line.match(/(?:aria-label|title|placeholder|alt)\s*=\s*"([^"]+)"/);
    const candidates = [];
    if (jsxText) candidates.push(jsxText[1]);
    if (attr) candidates.push(attr[1]);
    for (const candidate of candidates) {
      const trimmed = candidate.trim();
      if (!trimmed) continue;
      if (HANGUL_PATTERN.test(trimmed) || ENGLISH_SENTENCE.test(trimmed)) {
        violations.push({
          file: relative(repoRoot, file).split(sep).join("/"),
          line: i + 1,
          excerpt: trimmed.slice(0, 80),
        });
      }
    }
  }
}

if (violations.length === 0) {
  console.log("hardcoded-strings: clean");
  process.exit(0);
}

console.error(`hardcoded-strings: ${violations.length} potential literal(s) found.`);
for (const v of violations) {
  console.error(`  ${v.file}:${v.line}  ${v.excerpt}`);
}
console.error(
  "\nWrap these in `t('namespace.key')` or add `// i18n-allow` on the same line if intentional.",
);
process.exit(1);
