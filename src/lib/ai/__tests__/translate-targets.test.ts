// S-AI-009: translate target ranking coverage.

import { beforeEach, describe, expect, it } from "vitest";
import { QUICK_PICK, rankTargets, useTranslateHistory } from "../translate-targets";

beforeEach(() => {
  useTranslateHistory.setState({ recent: [] });
});

describe("rankTargets", () => {
  it("returns all quick picks with no query and no history", () => {
    const r = rankTargets("", []);
    expect(r).toHaveLength(QUICK_PICK.length);
  });

  it("floats recent targets to the top in recency order", () => {
    const r = rankTargets("", ["ja", "ko"]);
    expect(r[0]?.tag).toBe("ja");
    expect(r[1]?.tag).toBe("ko");
  });

  it("filters by tag substring", () => {
    const r = rankTargets("zh", []);
    expect(r.every((t) => t.tag.includes("zh") || t.label.includes("zh"))).toBe(true);
    expect(r.some((t) => t.tag === "zh-CN")).toBe(true);
  });

  it("filters by label substring case-insensitively", () => {
    const r = rankTargets("english", []);
    expect(r).toHaveLength(1);
    expect(r[0]?.tag).toBe("en");
  });

  it("returns empty for an unmatched query", () => {
    expect(rankTargets("xyzzy", [])).toEqual([]);
  });
});

describe("useTranslateHistory", () => {
  it("push prepends a tag", () => {
    useTranslateHistory.getState().push("ko");
    expect(useTranslateHistory.getState().recent[0]).toBe("ko");
  });

  it("push deduplicates and moves the tag to the front", () => {
    const { push } = useTranslateHistory.getState();
    push("ko");
    push("ja");
    push("ko");
    expect(useTranslateHistory.getState().recent).toEqual(["ko", "ja"]);
  });

  it("push caps history at five entries", () => {
    const { push } = useTranslateHistory.getState();
    for (const t of ["a", "b", "c", "d", "e", "f"]) push(t);
    expect(useTranslateHistory.getState().recent).toHaveLength(5);
    expect(useTranslateHistory.getState().recent[0]).toBe("f");
  });
});
