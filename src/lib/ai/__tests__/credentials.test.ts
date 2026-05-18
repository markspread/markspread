// S-AI-AUTH-002: ProviderCredential round-trip + 만료 감지 + v1 마이그레이션.

import { describe, expect, it } from "vitest";
import {
  type SubscriptionCredential,
  authModeOf,
  isSubscriptionExpired,
  migrateLegacyCredential,
  parseCredential,
  shouldRefreshSubscription,
} from "../credentials";

const APIKEY = {
  kind: "api-key" as const,
  providerId: "anthropic",
  alias: "default",
  encryptedKey: "enc::sk-abc",
};

const SUB: SubscriptionCredential = {
  kind: "subscription",
  providerId: "anthropic",
  alias: "default",
  encryptedAccessToken: "enc::at",
  encryptedRefreshToken: "enc::rt",
  expiresAt: Date.now() + 3600_000,
  accountLabel: "swlee@example.com",
};

describe("parseCredential", () => {
  it("round-trips an api-key credential", () => {
    const r = parseCredential(APIKEY);
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.credential.kind).toBe("api-key");
      expect(JSON.parse(JSON.stringify(r.credential))).toEqual(APIKEY);
    }
  });

  it("round-trips a subscription credential", () => {
    const r = parseCredential(SUB);
    expect(r.ok).toBe(true);
    if (r.ok && r.credential.kind === "subscription") {
      expect(r.credential.providerId).toBe("anthropic");
      expect(r.credential.expiresAt).toBe(SUB.expiresAt);
    }
  });

  it("rejects a subscription credential for a non-anthropic provider", () => {
    const r = parseCredential({ ...SUB, providerId: "openai" });
    expect(r.ok).toBe(false);
  });

  it("rejects an unknown kind", () => {
    const r = parseCredential({ kind: "device", providerId: "anthropic" });
    expect(r.ok).toBe(false);
  });

  it("rejects empty alias", () => {
    const r = parseCredential({ ...APIKEY, alias: "" });
    expect(r.ok).toBe(false);
  });

  it("rejects negative expiresAt", () => {
    const r = parseCredential({ ...SUB, expiresAt: -1 });
    expect(r.ok).toBe(false);
  });
});

describe("subscription expiry helpers", () => {
  it("isSubscriptionExpired returns true when expiresAt is in the past", () => {
    const now = 1_000_000;
    const expired: SubscriptionCredential = { ...SUB, expiresAt: now - 1 };
    expect(isSubscriptionExpired(expired, now)).toBe(true);
  });

  it("isSubscriptionExpired returns false when expiresAt is in the future", () => {
    const now = 1_000_000;
    const fresh: SubscriptionCredential = { ...SUB, expiresAt: now + 60_000 };
    expect(isSubscriptionExpired(fresh, now)).toBe(false);
  });

  it("shouldRefreshSubscription triggers in the lead window", () => {
    const now = 1_000_000;
    const soon: SubscriptionCredential = { ...SUB, expiresAt: now + 60_000 };
    expect(shouldRefreshSubscription(soon, now)).toBe(true);
  });

  it("shouldRefreshSubscription does not trigger far ahead of lead", () => {
    const now = 1_000_000;
    const later: SubscriptionCredential = { ...SUB, expiresAt: now + 30 * 60_000 };
    expect(shouldRefreshSubscription(later, now)).toBe(false);
  });
});

describe("migrateLegacyCredential", () => {
  it("labels a v1 api-key record (no kind) as kind: 'api-key'", () => {
    const legacy = {
      providerId: "anthropic",
      alias: "default",
      encryptedKey: "enc::sk-abc",
    };
    const r = migrateLegacyCredential(legacy);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.credential.kind).toBe("api-key");
  });

  it("leaves an already-labelled record untouched", () => {
    const r = migrateLegacyCredential(SUB);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.credential.kind).toBe("subscription");
  });

  it("rejects non-object input", () => {
    expect(migrateLegacyCredential(null).ok).toBe(false);
    expect(migrateLegacyCredential("abc").ok).toBe(false);
  });
});

describe("authModeOf", () => {
  it("maps api-key credential to 'api-key'", () => {
    const r = parseCredential(APIKEY);
    if (!r.ok) throw new Error("setup");
    expect(authModeOf(r.credential)).toBe("api-key");
  });

  it("maps subscription credential to 'subscription'", () => {
    const r = parseCredential(SUB);
    if (!r.ok) throw new Error("setup");
    expect(authModeOf(r.credential)).toBe("subscription");
  });
});
