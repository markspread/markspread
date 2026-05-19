// S-AIK-016 / S-AIK-017: keychain status probe coverage.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const invokeMock = vi.fn();
vi.mock("@tauri-apps/api/core", () => ({
  invoke: (...args: unknown[]) => invokeMock(...args),
}));

import { type KeychainStatus, probeKeychain, statusBanner } from "../keychain-status";

beforeEach(() => invokeMock.mockReset());
afterEach(() => invokeMock.mockReset());

describe("probeKeychain", () => {
  it("maps 'available'", async () => {
    invokeMock.mockResolvedValueOnce({ status: "available" });
    expect((await probeKeychain()).kind).toBe("available");
  });

  it("maps 'locked' with a hint", async () => {
    invokeMock.mockResolvedValueOnce({ status: "locked", hint: "unlock it" });
    const r = await probeKeychain();
    expect(r.kind).toBe("locked");
    if (r.kind === "locked") expect(r.hint).toBe("unlock it");
  });

  it("maps 'denied'", async () => {
    invokeMock.mockResolvedValueOnce({ status: "denied" });
    const r = await probeKeychain();
    expect(r.kind).toBe("denied");
  });

  it("maps 'missing'", async () => {
    invokeMock.mockResolvedValueOnce({ status: "missing", hint: "install keyring" });
    expect((await probeKeychain()).kind).toBe("missing");
  });

  it("treats an unknown status as missing", async () => {
    invokeMock.mockResolvedValueOnce({ status: "weird" });
    const r = await probeKeychain();
    expect(r.kind).toBe("missing");
  });

  it("returns missing with the error message when the invoke throws", async () => {
    invokeMock.mockRejectedValueOnce(new Error("ipc down"));
    const r = await probeKeychain();
    expect(r.kind).toBe("missing");
    if (r.kind === "missing") expect(r.hint).toBe("ipc down");
  });
});

describe("statusBanner", () => {
  it("returns null for an available keychain", () => {
    expect(statusBanner({ kind: "available" })).toBeNull();
  });

  it("returns a locked banner", () => {
    expect(statusBanner({ kind: "locked", hint: "x" })?.i18nKey).toBe("ai.keychain.locked");
  });

  it("returns a denied banner with the hint value", () => {
    const b = statusBanner({ kind: "denied", hint: "no perm" });
    expect(b?.values?.hint).toBe("no perm");
  });

  it("returns a missing banner with the hint value", () => {
    const s: KeychainStatus = { kind: "missing", hint: "no keyring" };
    expect(statusBanner(s)?.values?.hint).toBe("no keyring");
  });
});
