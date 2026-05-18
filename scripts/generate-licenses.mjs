#!/usr/bin/env node
// S-OP-012: regenerate src-tauri/licenses/licenses.json from
// `cargo about generate` (Rust deps) + `license-checker --json`
// (npm deps). Run before each release; the output ships as a
// Tauri resource and is read at runtime by ops_about_licenses.

import { execFileSync } from "node:child_process";
import { writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, "..");
const OUT = resolve(ROOT, "src-tauri/licenses/licenses.json");

function rustDeps() {
  // cargo-about emits one-license-per-line JSON; we just want a
  // flat array of {name, version, license, repository, text}.
  try {
    const raw = execFileSync("cargo", ["about", "generate", "--format", "json", "about.hbs"], {
      cwd: resolve(ROOT, "src-tauri"),
      encoding: "utf8",
    });
    const parsed = JSON.parse(raw);
    return (parsed.licenses ?? []).flatMap((l) =>
      l.used_by.map((u) => ({
        name: u.crate.name,
        version: u.crate.version,
        license: l.id,
        repository: u.crate.repository ?? null,
        text: l.text ?? "",
      })),
    );
  } catch (err) {
    console.warn("cargo about not available; skipping Rust deps:", err.message);
    return [];
  }
}

function npmDeps() {
  try {
    const raw = execFileSync("pnpm", ["licenses", "list", "--json", "--prod"], {
      cwd: ROOT,
      encoding: "utf8",
      maxBuffer: 32 * 1024 * 1024,
    });
    const parsed = JSON.parse(raw);
    const out = [];
    for (const [license, deps] of Object.entries(parsed)) {
      for (const d of deps) {
        out.push({
          name: d.name,
          version: d.versions?.[0] ?? "",
          license,
          repository: d.homepage ?? null,
          text: "",
        });
      }
    }
    return out;
  } catch (err) {
    console.warn("pnpm licenses not available; skipping npm deps:", err.message);
    return [];
  }
}

const all = [...rustDeps(), ...npmDeps()].sort((a, b) => a.name.localeCompare(b.name));
writeFileSync(OUT, `${JSON.stringify(all, null, 2)}\n`);
console.log(`Wrote ${OUT} (${all.length} entries).`);
