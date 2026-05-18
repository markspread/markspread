#!/usr/bin/env node
// S-A11-007: WCAG AA contrast check on the design tokens declared in
// src/styles.css. We parse the @theme blocks (light + dark) and verify every
// text-on-background pair clears the AA threshold:
//   - body text: 4.5 : 1
//   - large text (≥ 18 pt or 14 pt bold): 3 : 1
//
// We compute contrast in the standard sRGB-luminance space, converting from
// oklch via a culori-style polyfill so we don't depend on a runtime library
// in CI. Each violation prints the token pair, the measured ratio, and the
// required threshold.

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const repoRoot = join(__filename, "..", "..");
const cssPath = join(repoRoot, "src", "styles.css");

// --- oklch → sRGB ---------------------------------------------------------
function oklchToSrgb(L, C, hDeg) {
  const h = (hDeg * Math.PI) / 180;
  const a = Math.cos(h) * C;
  const b = Math.sin(h) * C;
  const l_ = L + 0.3963377774 * a + 0.2158037573 * b;
  const m_ = L - 0.1055613458 * a - 0.0638541728 * b;
  const s_ = L - 0.0894841775 * a - 1.291485548 * b;
  const l = l_ ** 3;
  const m = m_ ** 3;
  const s = s_ ** 3;
  let r = 4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s;
  let g = -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s;
  let bch = -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s;
  return [r, g, bch].map((v) => Math.max(0, Math.min(1, v)));
}

function relativeLuminance([r, g, b]) {
  const lin = (c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
  return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
}

function contrast(rgb1, rgb2) {
  const l1 = relativeLuminance(rgb1);
  const l2 = relativeLuminance(rgb2);
  const [hi, lo] = l1 > l2 ? [l1, l2] : [l2, l1];
  return (hi + 0.05) / (lo + 0.05);
}

// --- parse @theme blocks --------------------------------------------------
const css = readFileSync(cssPath, "utf8");
function parseThemeBlocks(text) {
  const blocks = [];
  const re = /@theme\s*\{([\s\S]*?)\}/g;
  let m;
  while ((m = re.exec(text)) !== null) blocks.push(m[1]);
  return blocks;
}

function parseTokens(block) {
  const tokens = {};
  const re = /(--color-[a-z-]+):\s*oklch\(\s*([\d.]+)%?\s+([\d.]+)\s+([\d.]+)\s*\)/g;
  let m;
  while ((m = re.exec(block)) !== null) {
    const L = parseFloat(m[2]) / 100;
    const C = parseFloat(m[3]);
    const H = parseFloat(m[4]);
    tokens[m[1]] = oklchToSrgb(L, C, H);
  }
  return tokens;
}

const blocks = parseThemeBlocks(css);
const themes = blocks.map(parseTokens);

const PAIRS = [
  { fg: "--color-fg", bg: "--color-bg", min: 4.5, label: "body text" },
  { fg: "--color-muted", bg: "--color-bg", min: 4.5, label: "muted text on bg" },
  { fg: "--color-accent", bg: "--color-bg", min: 3.0, label: "accent on bg (large)" },
  { fg: "--color-fg", bg: "--color-border", min: 3.0, label: "fg on border (large)" },
];

let failures = 0;
themes.forEach((tokens, idx) => {
  const mode = idx === 0 ? "light" : "dark";
  for (const p of PAIRS) {
    const fg = tokens[p.fg];
    const bg = tokens[p.bg];
    if (!fg || !bg) continue;
    const ratio = contrast(fg, bg);
    const ok = ratio >= p.min;
    const line = `${ok ? "PASS" : "FAIL"} ${mode} ${p.label} (${p.fg} / ${p.bg}): ${ratio.toFixed(2)}:1 (need ≥ ${p.min}:1)`;
    if (ok) console.log(line);
    else {
      console.error(line);
      failures += 1;
    }
  }
});

process.exit(failures === 0 ? 0 : 1);
