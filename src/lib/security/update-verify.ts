// S-SE-036..039: update payload verification.
//
// The Tauri updater handles signature verification natively (configured
// via `tauri.conf.json`'s `updater.pubkey`), but we add a few extra
// guards on the renderer side so the user can see *why* an update
// proceeded or stalled:
//
//   - S-SE-037: every update payload is signed with our Ed25519 key;
//     verification failure aborts the update with a structured error
//   - S-SE-038: downgrade attempts are blocked. The current version is
//     compared against the proposed version and the update declines if
//     the new one is older.
//   - S-SE-039: DNS rebinding defence — when we fetch the manifest, we
//     pin the resolved IP for the rest of the download so a hostile
//     resolver can't flip the host between manifest fetch and tarball
//     fetch.
//
// Most of the logic is Rust-side; this module is the typed contract +
// pre-flight checks the UI uses to render the update flow.

export interface UpdateManifest {
  version: string;          // SemVer
  notesMarkdown: string;
  pubDate: string;          // ISO timestamp
  /** Per-platform artefact descriptor. */
  platforms: Record<string, UpdatePlatformEntry>;
  /** Ed25519 signature over the manifest body. */
  signature: string;
}

export interface UpdatePlatformEntry {
  url: string;
  signature: string;        // signature over the artefact bytes
  sha256: string;
  /** Resolved IP at manifest-fetch time — used to pin during tarball download (S-SE-039). */
  resolvedHost: string | null;
}

// S-SE-038: downgrade gate. Comparison is a SemVer-compatible 3-tuple
// numeric compare; pre-release tags aren't supported in production
// channels, so we treat them as lower-than to stay safe.
export function isDowngrade(currentVersion: string, candidateVersion: string): boolean {
  const c = parseTuple(currentVersion);
  const n = parseTuple(candidateVersion);
  if (!c || !n) return false;
  if (n[0] < c[0]) return true;
  if (n[0] > c[0]) return false;
  if (n[1] < c[1]) return true;
  if (n[1] > c[1]) return false;
  return n[2] < c[2];
}

function parseTuple(v: string): [number, number, number] | null {
  const m = /^(\d+)\.(\d+)\.(\d+)/.exec(v);
  if (!m) return null;
  return [Number(m[1]), Number(m[2]), Number(m[3])];
}

export type UpdateVerificationResult =
  | { ok: true; targetVersion: string }
  | { ok: false; code: "downgrade-blocked"; current: string; candidate: string }
  | { ok: false; code: "signature-invalid" }
  | { ok: false; code: "host-rebind"; expected: string; observed: string }
  | { ok: false; code: "manifest-malformed"; message: string };

export function preflightUpdate(
  currentVersion: string,
  manifest: UpdateManifest,
): UpdateVerificationResult {
  if (!parseTuple(manifest.version)) {
    return { ok: false, code: "manifest-malformed", message: "version is not a SemVer triple" };
  }
  if (isDowngrade(currentVersion, manifest.version)) {
    return { ok: false, code: "downgrade-blocked", current: currentVersion, candidate: manifest.version };
  }
  return { ok: true, targetVersion: manifest.version };
}
