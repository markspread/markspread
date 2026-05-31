// ADR-0015 §3: Commercial License honor system 테스트.

import { describe, expect, it } from "vitest";
import {
  type CommercialLicense,
  type LicenseEnv,
  recommendationMessage,
  shouldRecommendCommercial,
  status,
} from "../commercial";

const env: LicenseEnv = {
  now: "2026-06-01T00:00:00Z",
  manageBaseUrl: "https://markspread.app/license",
};

describe("status — free tier", () => {
  it("null license → free tier label", () => {
    const s = status(null, env);
    expect(s.tier).toBe("free");
    expect(s.label).toMatch(/Free.*AGPL/);
    expect(s.expiresSoon).toBe(false);
    expect(s.manageUrl).toBe("https://markspread.app/license");
  });
});

describe("status — commercial", () => {
  const baseLic: CommercialLicense = {
    customerId: "cus_abc",
    subscriptionId: "sub_xyz",
    startedAt: "2026-01-01T00:00:00Z",
    renewsAt: "2027-01-01T00:00:00Z",
    licenseId: "lic_001",
  };

  it("commercial tier with default label", () => {
    const s = status(baseLic, env);
    expect(s.tier).toBe("commercial");
    expect(s.label).toMatch(/Commercial.*50/);
    expect(s.expiresOn).toBe(baseLic.renewsAt);
  });

  it("organization name in label when provided", () => {
    const s = status({ ...baseLic, organization: "Acme Inc" }, env);
    expect(s.label).toBe("Commercial — Acme Inc");
  });

  it("expiresSoon true when within 30 days", () => {
    const soon = { ...baseLic, renewsAt: "2026-06-15T00:00:00Z" };
    expect(status(soon, env).expiresSoon).toBe(true);
  });

  it("expiresSoon false when far in future", () => {
    expect(status(baseLic, env).expiresSoon).toBe(false);
  });

  it("expiresSoon false when already expired (negative days)", () => {
    const past = { ...baseLic, renewsAt: "2026-05-01T00:00:00Z" };
    expect(status(past, env).expiresSoon).toBe(false);
  });

  it("manageUrl encodes customer id", () => {
    const s = status(baseLic, env);
    expect(s.manageUrl).toContain("customer=cus_abc");
  });
});

describe("shouldRecommendCommercial", () => {
  it("returns false when user already licensed", () => {
    expect(
      shouldRecommendCommercial({
        workspacePath: "/home/u/work/company",
        homePath: "/home/u",
        hasUserLicense: true,
      }),
    ).toBe(false);
  });

  it("respects explicit org flag", () => {
    expect(
      shouldRecommendCommercial({
        workspacePath: "/anywhere",
        homePath: "/home/u",
        hasUserLicense: false,
        explicitOrgFlag: true,
      }),
    ).toBe(true);
    expect(
      shouldRecommendCommercial({
        workspacePath: "/home/u/company",
        homePath: "/home/u",
        hasUserLicense: false,
        explicitOrgFlag: false,
      }),
    ).toBe(false);
  });

  it("recommends when workspace is outside home", () => {
    expect(
      shouldRecommendCommercial({
        workspacePath: "/srv/shared/docs",
        homePath: "/home/u",
        hasUserLicense: false,
      }),
    ).toBe(true);
  });

  it("recommends when path contains org heuristic keywords", () => {
    expect(
      shouldRecommendCommercial({
        workspacePath: "/home/u/work/company-project",
        homePath: "/home/u",
        hasUserLicense: false,
      }),
    ).toBe(true);
    expect(
      shouldRecommendCommercial({
        workspacePath: "/home/u/work/team-x",
        homePath: "/home/u",
        hasUserLicense: false,
      }),
    ).toBe(true);
  });

  it("does NOT recommend pure personal workspace", () => {
    expect(
      shouldRecommendCommercial({
        workspacePath: "/home/u/notes",
        homePath: "/home/u",
        hasUserLicense: false,
      }),
    ).toBe(false);
  });
});

describe("recommendationMessage", () => {
  it("references AGPL honor system", () => {
    expect(recommendationMessage()).toMatch(/AGPL.*honor/);
  });
});
