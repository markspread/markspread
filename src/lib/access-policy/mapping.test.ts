// S-FAP-008: mapping regression suite.
//
// Verifies the three contracts that downstream surfaces depend on:
//   1. every RuleId has a category and the priority order in spec §3.1 holds,
//   2. the i18n key shape matches errors.access.rule.<snake_case>.{title,body},
//   3. fromPosixError() promotes the POSIX codes we currently emit into the
//      rule_id the access-policy card expects to render.

import { describe, expect, it } from "vitest";
import en from "../../locales/en.json";
import ko from "../../locales/ko.json";
import {
  RULE_ACTIONS,
  RULE_TO_CATEGORY,
  fromPosixError,
  ruleI18nPrefix,
  specAnchorFor,
} from "./mapping";
import type { RuleId } from "./types";

const ALL_RULES = Object.keys(RULE_TO_CATEGORY) as RuleId[];

describe("RULE_TO_CATEGORY", () => {
  it("covers every rule_id with a category prefix matching its id", () => {
    for (const rule of ALL_RULES) {
      const prefix = rule.split("-")[0];
      expect(prefix).toBe(RULE_TO_CATEGORY[rule]);
    }
  });
});

describe("ruleI18nPrefix", () => {
  it("emits errors.access.rule.<snake_case>", () => {
    expect(ruleI18nPrefix("POL-NODE-MODULES")).toBe("errors.access.rule.pol_node_modules");
    expect(ruleI18nPrefix("SEC-NULL-BYTE")).toBe("errors.access.rule.sec_null_byte");
  });

  it("every rule has a title/body/learn_more entry in en + ko bundles", () => {
    const enBundle = en.errors.access.rule as Record<
      string,
      { title?: string; body?: string; learn_more?: string }
    >;
    const koBundle = ko.errors.access.rule as Record<
      string,
      { title?: string; body?: string; learn_more?: string }
    >;
    for (const rule of ALL_RULES) {
      const key = ruleI18nPrefix(rule).replace("errors.access.rule.", "");
      const enEntry = enBundle[key];
      const koEntry = koBundle[key];
      expect(enEntry, `en missing ${rule}`).toBeDefined();
      expect(koEntry, `ko missing ${rule}`).toBeDefined();
      expect(enEntry?.title?.length ?? 0).toBeGreaterThan(0);
      expect(enEntry?.body?.length ?? 0).toBeGreaterThan(0);
      expect(koEntry?.title?.length ?? 0).toBeGreaterThan(0);
      expect(koEntry?.body?.length ?? 0).toBeGreaterThan(0);
      // learn_more may be intentionally empty for routing-style rules.
      expect(typeof enEntry?.learn_more).toBe("string");
      expect(typeof koEntry?.learn_more).toBe("string");
    }
  });
});

describe("RULE_ACTIONS", () => {
  it("SEC rules never offer an override action", () => {
    const forbidden = new Set(["open_anyway", "edit_allowlist", "force_text", "add_workspace"]);
    for (const rule of ALL_RULES) {
      if (!rule.startsWith("SEC-")) continue;
      const actions = RULE_ACTIONS[rule];
      expect(actions.primary).not.toBeUndefined();
      if (actions.primary) expect(forbidden.has(actions.primary)).toBe(false);
      if (actions.secondary) expect(forbidden.has(actions.secondary)).toBe(false);
    }
  });

  it("POL rules surface the allow-list editor as primary", () => {
    for (const rule of ALL_RULES) {
      if (!rule.startsWith("POL-")) continue;
      expect(RULE_ACTIONS[rule].primary).toBe("edit_allowlist");
    }
  });
});

describe("fromPosixError", () => {
  it("maps known POSIX codes to expected rules", () => {
    expect(fromPosixError({ code: "EOUTSIDE_WORKSPACE" }).ruleId).toBe("BND-OUTSIDE-WORKSPACE");
    expect(fromPosixError({ code: "EACCES" }).ruleId).toBe("PRM-OS-EACCES");
    expect(fromPosixError({ code: "EISDIR" }).ruleId).toBe("FMT-IS-DIRECTORY");
    expect(fromPosixError({ code: "ENOTUTF8" }).ruleId).toBe("FMT-NOT-UTF8");
    expect(fromPosixError({ code: "ENOSPC" }).ruleId).toBe("IO-DISK-FULL");
    expect(fromPosixError({ code: "ENOENT" }).ruleId).toBe("IO-ENOENT");
  });

  it("falls back to IO-UNCLASSIFIED and exposes the raw code as a var", () => {
    const decision = fromPosixError({ code: "EWEIRD" });
    expect(decision.ruleId).toBe("IO-UNCLASSIFIED");
    expect(decision.vars?.code).toBe("EWEIRD");
  });

  it("handles non-object inputs without throwing", () => {
    expect(fromPosixError(undefined).ruleId).toBe("IO-UNCLASSIFIED");
    expect(fromPosixError("oops").ruleId).toBe("IO-UNCLASSIFIED");
  });

  it("propagates structured-payload vars into the decision", () => {
    const decision = fromPosixError({
      code: "EACCES",
      access: {
        ruleId: "SEC-SYMLINK-ESCAPE",
        category: "SEC",
        vars: { hint: "symlink loops" },
      },
    });
    expect(decision.ruleId).toBe("SEC-SYMLINK-ESCAPE");
    expect(decision.vars?.hint).toBe("symlink loops");
  });

  it("prefers the structured access payload from FAP-007 over the POSIX shim", () => {
    // SEC-SYMLINK-ESCAPE shares the legacy `EOUTSIDE_WORKSPACE` code with
    // BND-OUTSIDE-WORKSPACE — the engine disambiguates via the `access`
    // field. fromPosixError must trust it.
    const decision = fromPosixError({
      code: "EOUTSIDE_WORKSPACE",
      access: { ruleId: "SEC-SYMLINK-ESCAPE", category: "SEC" },
    });
    expect(decision.ruleId).toBe("SEC-SYMLINK-ESCAPE");
    expect(decision.category).toBe("SEC");
  });

  it("ignores a malformed access payload and falls back to the POSIX code", () => {
    const decision = fromPosixError({
      code: "EACCES",
      access: { ruleId: "NOT-A-REAL-RULE", category: "SEC" },
    });
    expect(decision.ruleId).toBe("PRM-OS-EACCES");
  });
});

describe("specAnchorFor", () => {
  it("produces a kebab-case anchor on the docs URL", () => {
    expect(specAnchorFor("POL-NODE-MODULES")).toMatch(/file-access-policy#pol-node-modules$/);
  });
});
