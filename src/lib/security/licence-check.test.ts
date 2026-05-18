// S-TST-016: licence allow-list assertion (delegates to S-SE-030).
//
// The actual scanner lives in `scripts/check-licences.mjs` (Node script
// run from CI). Here we test the *table* the scanner enforces against —
// `SAFE_LICENCES` from `src/lib/plugins/marketplace.ts` is the same
// source of truth shared with the marketplace UI ("compatible licence"
// badge), so a regression in either drift would let a non-permissive
// dependency slip through.
//
// What we assert:
//   - `SAFE_LICENCES` only contains permissive entries (no GPL/AGPL/SSPL).
//   - The allow-list matches the spelling SPDX expects.
//   - OR-clauses are normalised — `MIT OR Apache-2.0` is allowed if
//     either side is permissive.

import { describe, expect, it } from "vitest";
import { SAFE_LICENCES, isLicenceAllowed } from "./licence-check";

const PROHIBITED = ["GPL-2.0-only", "GPL-3.0-only", "AGPL-3.0-only", "SSPL-1.0"];

describe("SAFE_LICENCES", () => {
  it("only lists permissive SPDX identifiers", () => {
    for (const lic of SAFE_LICENCES) {
      expect(PROHIBITED).not.toContain(lic);
    }
  });

  it("includes the staples", () => {
    for (const lic of ["MIT", "Apache-2.0", "BSD-2-Clause", "BSD-3-Clause", "ISC"]) {
      expect(SAFE_LICENCES).toContain(lic);
    }
  });
});

describe("isLicenceAllowed", () => {
  it("accepts a single safe id", () => {
    expect(isLicenceAllowed("MIT")).toBe(true);
  });

  it("accepts an OR-clause when at least one side is safe", () => {
    expect(isLicenceAllowed("MIT OR Apache-2.0")).toBe(true);
    expect(isLicenceAllowed("(MIT OR Apache-2.0)")).toBe(true);
    expect(isLicenceAllowed("Apache-2.0 OR LGPL-3.0-only")).toBe(true);
  });

  it("rejects a single prohibited id", () => {
    expect(isLicenceAllowed("GPL-3.0-only")).toBe(false);
  });

  it("rejects an OR-clause where every side is prohibited", () => {
    expect(isLicenceAllowed("GPL-3.0-only OR AGPL-3.0-only")).toBe(false);
  });

  it("rejects unknown identifiers conservatively", () => {
    expect(isLicenceAllowed("Foo-License-1.0")).toBe(false);
  });

  it("treats AND-clauses strictly — every side must be safe", () => {
    expect(isLicenceAllowed("MIT AND Apache-2.0")).toBe(true);
    expect(isLicenceAllowed("MIT AND GPL-3.0-only")).toBe(false);
  });
});
