// S-TST-015: i18n missing-key + extra-key checker (delegates S-I18-013/014).
//
// Three failure modes block CI:
//   1. A locale file is missing a key the source-of-truth (`en`)
//      defines.
//   2. A locale file has a key `en` doesn't define (rot from a
//      removed feature).
//   3. The codebase calls `t("…")` with a key not declared in `en`.
//
// We treat `en/*.json` as the source of truth — the source code calls
// `t("settings.ai.add-key")` with literal strings, so we statically
// extract every literal and cross-check against the JSON. Missing
// translations in non-`en` files are warnings unless `--strict` is set
// (CI sets `--strict` after the locale freezes for a release).

import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative, resolve } from "node:path";

const REPO = resolve(new URL(".", import.meta.url).pathname, "..");
const LOCALES_DIR = join(REPO, "src/locales");
const SRC_DIR = join(REPO, "src");
const STRICT = process.argv.includes("--strict");

function walk(dir, ext, out = []) {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    const st = statSync(full);
    if (st.isDirectory()) walk(full, ext, out);
    else if (entry.endsWith(ext)) out.push(full);
  }
  return out;
}

function flatten(obj, prefix = "", out = new Set()) {
  for (const [k, v] of Object.entries(obj)) {
    const path = prefix ? `${prefix}.${k}` : k;
    if (v && typeof v === "object" && !Array.isArray(v)) flatten(v, path, out);
    else out.add(path);
  }
  return out;
}

function readLocaleKeys(locale) {
  const dir = join(LOCALES_DIR, locale);
  const keys = new Set();
  for (const file of walk(dir, ".json")) {
    const json = JSON.parse(readFileSync(file, "utf8"));
    flatten(json, "", keys);
  }
  return keys;
}

const T_CALL = /\bt\(\s*(["'`])([^"'`]+?)\1/g;
function extractCalledKeys() {
  const calls = new Set();
  for (const file of walk(SRC_DIR, ".ts").concat(walk(SRC_DIR, ".tsx"))) {
    if (file.endsWith(".test.ts") || file.endsWith(".test.tsx")) continue;
    const src = readFileSync(file, "utf8");
    let m = T_CALL.exec(src);
    while (m !== null) {
      calls.add(m[2]);
      m = T_CALL.exec(src);
    }
  }
  return calls;
}

const locales = readdirSync(LOCALES_DIR).filter((d) =>
  statSync(join(LOCALES_DIR, d)).isDirectory(),
);
if (!locales.includes("en")) {
  console.error("FATAL: src/locales/en is missing — `en` is the source of truth.");
  process.exit(2);
}

const enKeys = readLocaleKeys("en");
const calledKeys = extractCalledKeys();

let errors = 0;
let warnings = 0;

for (const key of calledKeys) {
  if (!enKeys.has(key)) {
    console.error(`ERR  source calls t("${key}") but \`en\` does not define it`);
    errors += 1;
  }
}

for (const locale of locales) {
  if (locale === "en") continue;
  const k = readLocaleKeys(locale);
  for (const key of enKeys) {
    if (!k.has(key)) {
      const level = STRICT ? "ERR " : "WARN";
      console.error(`${level} ${locale} missing key: ${key}`);
      if (STRICT) errors += 1;
      else warnings += 1;
    }
  }
  for (const key of k) {
    if (!enKeys.has(key)) {
      console.error(`ERR  ${locale} has key not in en: ${key}`);
      errors += 1;
    }
  }
}

console.error(
  `\ni18n check: en=${enKeys.size} keys, called=${calledKeys.size} keys, ` +
    `${errors} errors, ${warnings} warnings (strict=${STRICT})`,
);

process.exit(errors > 0 ? 1 : 0);
