// S-PLM-027: official-plugin badge via Ed25519 signature verification.
//
// Plugins published by the Markspread team carry a detached signature
// over the tarball's sha512 digest, signed by the project's offline
// Ed25519 key. The public key is pinned at build time in the host
// binary; signatures are fetched from a sibling URL of the tarball
// (`<tarball>.sig`). Verification happens Rust-side using the `ed25519-dalek`
// crate; this TS surface is the IPC wrapper plus UI badge logic.
//
// We never use the badge as a security boundary — the sandbox + manifest
// checks gate what *every* plugin can do. The badge is a trust hint:
// "this plugin's bytes were signed by Markspread", nothing more.

import { invoke } from "@tauri-apps/api/core";

export interface SignatureVerification {
  /** True only when the signature exists, parses, and verifies. */
  ok: boolean;
  /** Why verification failed (missing signature, bad signature, key mismatch). */
  reason?: "no-signature" | "bad-signature" | "key-mismatch" | "fetch-failed";
  /** The publisher key fingerprint we matched against. */
  fingerprint?: string;
  /** Timestamp the verification ran — useful for the badge tooltip. */
  verifiedAt: number;
}

export async function verifySignature(tarballUrl: string, sha512: string): Promise<SignatureVerification> {
  return invoke<SignatureVerification>("plugin_marketplace_verify_signature", { tarballUrl, sha512 });
}

// Pinned project key fingerprint — derived from the public key bytes
// shipped with the build. The renderer uses this only for display ("This
// plugin was signed by Markspread <fp>"); the actual cryptographic check
// lives in Rust.
export const MARKSPREAD_KEY_FINGERPRINT = "ms1:ed25519:0000000000000000000000000000000000000000000000000000000000000000";
