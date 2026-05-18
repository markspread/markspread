// S-CI-016: compose latest.json for the Tauri updater feed.
//
// Tauri's updater spec: a JSON document with `version`, optional
// `notes`, an ISO `pub_date`, and a `platforms` map keyed by
// `<os>-<arch>` whose entries carry the artifact `url` + a base64
// `signature` (produced by tauri-cli when TAURI_SIGNING_PRIVATE_KEY is
// set during build, S-CI-015).
//
// The build artifacts arrive as separate folders per platform (one
// upload-artifact step per matrix shard). This script walks them,
// reads the `.sig` sidecars Tauri emits next to the binary, and stamps
// the public download URL — so the renderer's updater module just
// needs to point at this file.

import { readFileSync, readdirSync, statSync } from "node:fs";
import { extname, join } from "node:path";
import { argv, exit } from "node:process";

function arg(flag, fallback) {
  const i = argv.indexOf(flag);
  if (i === -1) return fallback;
  return argv[i + 1];
}

const tag      = arg("--tag");
const channel  = arg("--channel", "stable");
const distDir  = arg("--dist", "dist");
const baseUrl  = arg("--base-url", "https://releases.markspread.app");
const notesPath = arg("--notes");

if (!tag) { console.error("--tag is required"); exit(1); }
const version = tag.replace(/^v/, "").replace(/^nightly-/, "0.0.0-nightly-");

// Map a filename to a Tauri platform key.
function platformOf(file) {
  if (file.endsWith(".dmg") && file.includes("aarch64")) return "darwin-aarch64";
  if (file.endsWith(".dmg")) return "darwin-x86_64";
  if (file.endsWith(".app.tar.gz") && file.includes("aarch64")) return "darwin-aarch64";
  if (file.endsWith(".app.tar.gz")) return "darwin-x86_64";
  if (file.endsWith(".msi.zip")) return "windows-x86_64";
  if (file.endsWith(".AppImage.tar.gz") && file.includes("aarch64")) return "linux-aarch64";
  if (file.endsWith(".AppImage.tar.gz")) return "linux-x86_64";
  return null;
}

function walk(dir, out = []) {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    const st = statSync(full);
    if (st.isDirectory()) walk(full, out);
    else out.push(full);
  }
  return out;
}

const platforms = {};
for (const file of walk(distDir)) {
  const platform = platformOf(file);
  if (!platform) continue;
  const sigPath = `${file}.sig`;
  let signature = "";
  try { signature = readFileSync(sigPath, "utf8").trim(); }
  catch { /* sig only emitted when TAURI_SIGNING_PRIVATE_KEY was set */ }

  const relativePath = file.replace(`${distDir}/`, "");
  platforms[platform] = {
    url: `${baseUrl}/${tag}/${relativePath}`,
    signature,
  };
}

const manifest = {
  version,
  pub_date: new Date().toISOString(),
  notes: notesPath ? readFileSync(notesPath, "utf8") : "",
  platforms,
};

if (channel === "beta") manifest.channel = "beta";

process.stdout.write(JSON.stringify(manifest, null, 2));
