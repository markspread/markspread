// S-FAP-008: rule → category, rule → recommended actions, rule ↔ i18n key.
//
// The mappings here are the SoT for the renderer; FAP-007 returns the rule_id
// and the renderer derives the rest from these tables. Spec sections referenced
// inline: §3.1 category priority, §4.2 rules, §5.2 rule→action mapping.

import type { AccessCategory, AccessDecision, ActionId, RuleId } from "./types";

export const RULE_TO_CATEGORY: Record<RuleId, AccessCategory> = {
  "SEC-NULL-BYTE": "SEC",
  "SEC-PATH-TRAVERSAL": "SEC",
  "SEC-SYMLINK-ESCAPE": "SEC",
  "BND-OUTSIDE-WORKSPACE": "BND",
  "PRM-OS-EACCES": "PRM",
  "POL-VCS-INTERNAL": "POL",
  "POL-NODE-MODULES": "POL",
  "POL-BUILD-OUTPUT": "POL",
  "POL-LANG-CACHE": "POL",
  "POL-IDE-INTERNAL": "POL",
  "POL-PLATFORM-CRUFT": "POL",
  "PRF-FILE-SIZE-LIMIT": "PRF",
  "PRF-FILE-SIZE-WARN": "PRF",
  "PRF-DIR-NODE-COUNT": "PRF",
  "FMT-NOT-UTF8": "FMT",
  "FMT-IS-DIRECTORY": "FMT",
  "FMT-BINARY-SNIFF": "FMT",
  "IO-DISK-FULL": "IO",
  "IO-ENOENT": "IO",
  "IO-UNCLASSIFIED": "IO",
};

export interface RuleActions {
  primary?: ActionId;
  secondary?: ActionId;
}

// Spec §5.2 룰 → 권장 액션 매핑 표.
export const RULE_ACTIONS: Record<RuleId, RuleActions> = {
  "SEC-NULL-BYTE": { primary: "copy_diagnostics", secondary: "learn_more" },
  "SEC-PATH-TRAVERSAL": { primary: "copy_diagnostics", secondary: "learn_more" },
  "SEC-SYMLINK-ESCAPE": { primary: "copy_diagnostics", secondary: "learn_more" },
  "BND-OUTSIDE-WORKSPACE": { primary: "add_workspace", secondary: "learn_more" },
  "PRM-OS-EACCES": { primary: "retry", secondary: "learn_more" },
  "POL-VCS-INTERNAL": { primary: "edit_allowlist", secondary: "learn_more" },
  "POL-NODE-MODULES": { primary: "edit_allowlist", secondary: "learn_more" },
  "POL-BUILD-OUTPUT": { primary: "edit_allowlist", secondary: "learn_more" },
  "POL-LANG-CACHE": { primary: "edit_allowlist", secondary: "learn_more" },
  "POL-IDE-INTERNAL": { primary: "edit_allowlist", secondary: "learn_more" },
  "POL-PLATFORM-CRUFT": { primary: "edit_allowlist", secondary: "learn_more" },
  "PRF-FILE-SIZE-LIMIT": { primary: "open_anyway", secondary: "learn_more" },
  "PRF-FILE-SIZE-WARN": {},
  "PRF-DIR-NODE-COUNT": { primary: "edit_allowlist", secondary: "learn_more" },
  "FMT-NOT-UTF8": { primary: "force_text", secondary: "learn_more" },
  "FMT-IS-DIRECTORY": { primary: "show_in_tree" },
  "FMT-BINARY-SNIFF": { primary: "open_image_viewer", secondary: "force_text" },
  "IO-DISK-FULL": { primary: "retry" },
  "IO-ENOENT": { primary: "retry", secondary: "show_in_tree" },
  "IO-UNCLASSIFIED": { primary: "retry", secondary: "copy_diagnostics" },
};

// Spec §5.3: rule_id → i18n key. snake_case 변환, 캐시.
const I18N_PREFIX_CACHE = new Map<RuleId, string>();
export function ruleI18nPrefix(rule: RuleId): string {
  const cached = I18N_PREFIX_CACHE.get(rule);
  if (cached !== undefined) return cached;
  const key = `errors.access.rule.${rule.toLowerCase().replace(/-/g, "_")}`;
  I18N_PREFIX_CACHE.set(rule, key);
  return key;
}

// FAP-007 landed: Rust's `AppError` now carries an `access` payload alongside
// the legacy POSIX `code`. We prefer that when it's present so the renderer
// sees the engine's own categorisation (e.g. SEC-SYMLINK-ESCAPE vs the
// `EOUTSIDE_WORKSPACE` it shares a code with). The POSIX-only fallback is
// retained for IPC errors that bypass the engine (raw io errors from
// commands that haven't been migrated yet).
export function fromPosixError(raw: unknown): AccessDecision {
  if (raw && typeof raw === "object") {
    const candidate = (raw as { access?: unknown }).access;
    if (candidate && typeof candidate === "object") {
      const decision = candidate as Partial<AccessDecision>;
      if (
        typeof decision.ruleId === "string" &&
        typeof decision.category === "string" &&
        decision.ruleId in RULE_TO_CATEGORY
      ) {
        return {
          ruleId: decision.ruleId as RuleId,
          category: decision.category as AccessCategory,
          ...(decision.vars ? { vars: decision.vars } : {}),
        };
      }
    }
  }
  const code = raw && typeof raw === "object" ? (raw as { code?: unknown }).code : undefined;
  switch (code) {
    case "EOUTSIDE_WORKSPACE":
      return { ruleId: "BND-OUTSIDE-WORKSPACE", category: "BND" };
    case "EACCES":
      return { ruleId: "PRM-OS-EACCES", category: "PRM" };
    case "EISDIR":
      return { ruleId: "FMT-IS-DIRECTORY", category: "FMT" };
    case "ENOTUTF8":
      return { ruleId: "FMT-NOT-UTF8", category: "FMT" };
    case "ENOSPC":
      return { ruleId: "IO-DISK-FULL", category: "IO" };
    case "ENOENT":
      return { ruleId: "IO-ENOENT", category: "IO" };
    default: {
      const codeStr = typeof code === "string" && code.length > 0 ? code : "EIO";
      return { ruleId: "IO-UNCLASSIFIED", category: "IO", vars: { code: codeStr } };
    }
  }
}

// Public docs URL for the spec — used by the card's "왜?" link. The anchor is
// the kebab-case rule_id (the markdown header in file-access-policy.md uses the
// rule_id verbatim under §4.2 / §5.3 cross-references).
export const SPEC_DOC_URL = "https://docs.markspread.dev/spec/file-access-policy";
export function specAnchorFor(rule: RuleId): string {
  return `${SPEC_DOC_URL}#${rule.toLowerCase()}`;
}
