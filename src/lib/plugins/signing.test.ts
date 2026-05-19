// S-TST: official-plugin signature verification IPC wrapper.

import { beforeEach, describe, expect, it, vi } from "vitest";

const invoke = vi.fn();
vi.mock("@tauri-apps/api/core", () => ({
  invoke: (...args: unknown[]) => invoke(...args),
}));

import { MARKSPREAD_KEY_FINGERPRINT, verifySignature } from "./signing";

beforeEach(() => {
  invoke.mockReset();
});

describe("verifySignature", () => {
  it("forwards the tarball URL and sha512 to the Rust verifier", async () => {
    invoke.mockResolvedValueOnce({ ok: true, verifiedAt: 1 });
    const result = await verifySignature("https://host/p.tgz", "abc123");
    expect(result.ok).toBe(true);
    expect(invoke).toHaveBeenCalledWith("plugin_marketplace_verify_signature", {
      tarballUrl: "https://host/p.tgz",
      sha512: "abc123",
    });
  });

  it("relays a failure verdict from the host", async () => {
    invoke.mockResolvedValueOnce({
      ok: false,
      reason: "bad-signature",
      verifiedAt: 2,
    });
    const result = await verifySignature("https://host/p.tgz", "deadbeef");
    expect(result.ok).toBe(false);
    expect(result.reason).toBe("bad-signature");
  });
});

describe("MARKSPREAD_KEY_FINGERPRINT", () => {
  it("is a pinned ed25519 fingerprint", () => {
    expect(MARKSPREAD_KEY_FINGERPRINT).toMatch(/^ms1:ed25519:[0-9a-f]{64}$/);
  });
});
