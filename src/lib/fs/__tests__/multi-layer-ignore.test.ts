// ADR-0014 (T2.h): 다층 ignore matcher 테스트.

import { describe, expect, it } from "vitest";
import { type MultiLayerIgnore, fromWorkspaceFiles } from "../multi-layer-ignore";

const ROOT = "/ws";

function mk(gitignore?: string, markspreadignore?: string): MultiLayerIgnore {
  return fromWorkspaceFiles(ROOT, { gitignore, markspreadignore });
}

describe("MultiLayerIgnore — basic patterns", () => {
  it("blank lines and comments ignored", () => {
    const m = mk("\n# comment\n\nnode_modules\n");
    expect(m.isIgnored(`${ROOT}/node_modules`, true)).toBe(true);
    expect(m.isIgnored(`${ROOT}/src`, true)).toBe(false);
  });

  it("plain filename matches anywhere", () => {
    const m = mk(".DS_Store\n");
    expect(m.isIgnored(`${ROOT}/.DS_Store`)).toBe(true);
    expect(m.isIgnored(`${ROOT}/sub/.DS_Store`)).toBe(true);
    expect(m.isIgnored(`${ROOT}/sub/notds`)).toBe(false);
  });

  it("anchored pattern (leading /) matches only at root", () => {
    const m = mk("/secret\n");
    expect(m.isIgnored(`${ROOT}/secret`)).toBe(true);
    expect(m.isIgnored(`${ROOT}/sub/secret`)).toBe(false);
  });

  it("directory-only pattern (trailing /) requires isDirectory=true", () => {
    const m = mk("logs/\n");
    expect(m.isIgnored(`${ROOT}/logs`, true)).toBe(true);
    expect(m.isIgnored(`${ROOT}/logs`, false)).toBe(false);
  });

  it("* wildcard matches segment", () => {
    const m = mk("*.log\n");
    expect(m.isIgnored(`${ROOT}/foo.log`)).toBe(true);
    expect(m.isIgnored(`${ROOT}/sub/foo.log`)).toBe(true);
    expect(m.isIgnored(`${ROOT}/foo.txt`)).toBe(false);
  });

  it("** deep wildcard matches across segments", () => {
    const m = mk("**/cache\n");
    expect(m.isIgnored(`${ROOT}/cache`, true)).toBe(true);
    expect(m.isIgnored(`${ROOT}/deep/nested/cache`, true)).toBe(true);
  });

  it("? matches single character", () => {
    const m = mk("file?.txt\n");
    expect(m.isIgnored(`${ROOT}/file1.txt`)).toBe(true);
    expect(m.isIgnored(`${ROOT}/file12.txt`)).toBe(false);
  });
});

describe("MultiLayerIgnore — negation", () => {
  it("! re-includes a previously ignored path", () => {
    const m = mk("*.log\n!important.log\n");
    expect(m.isIgnored(`${ROOT}/random.log`)).toBe(true);
    expect(m.isIgnored(`${ROOT}/important.log`)).toBe(false);
  });

  it("order matters — later rule overrides earlier", () => {
    const m = mk("*.log\n!keep.log\nkeep.log\n");
    expect(m.isIgnored(`${ROOT}/keep.log`)).toBe(true); // re-ignored
  });
});

describe("MultiLayerIgnore — multi-layer interaction", () => {
  it("markspreadignore layer applies after gitignore", () => {
    const m = mk("*.log\n", "!important.log\n");
    expect(m.isIgnored(`${ROOT}/foo.log`)).toBe(true);
    expect(m.isIgnored(`${ROOT}/important.log`)).toBe(false);
  });

  it("markspreadignore can add new ignores beyond gitignore", () => {
    const m = mk("*.log\n", "private/\n");
    expect(m.isIgnored(`${ROOT}/private`, true)).toBe(true);
  });

  it("absent layers are fine (default no-op)", () => {
    const m = mk();
    expect(m.isIgnored(`${ROOT}/anything`)).toBe(false);
  });

  it("path outside workspace root is never ignored", () => {
    const m = mk("*.log\n");
    expect(m.isIgnored("/elsewhere/foo.log")).toBe(false);
  });
});

describe("MultiLayerIgnore — explain", () => {
  it("returns all matching rules across layers", () => {
    const m = mk("*.log\nbig.log\n", "!big.log\n");
    const matches = m.explain(`${ROOT}/big.log`);
    const codes = matches.map((mm) => mm.rule);
    expect(codes).toContain("*.log");
    expect(codes).toContain("big.log");
    expect(codes).toContain("!big.log");
  });

  it("includes layer source", () => {
    const m = mk("*.log\n", "private/\n");
    const matches = m.explain(`${ROOT}/private`, true);
    const sources = matches.map((mm) => mm.layer);
    expect(sources).toContain(".markspreadignore");
  });
});

describe("MultiLayerIgnore — typical workspace patterns", () => {
  it("ignores common build/cache dirs", () => {
    const m = mk("node_modules\n.git\ndist\nbuild\ntarget\n.next\n.pytest_cache\n__pycache__\n");
    for (const d of ["node_modules", ".git", "dist", "build", "target", ".next"]) {
      expect(m.isIgnored(`${ROOT}/${d}`, true)).toBe(true);
    }
    expect(m.isIgnored(`${ROOT}/src`, true)).toBe(false);
  });

  it("respects .markspreadignore extending base", () => {
    const m = mk("node_modules\n.git\n", "# 본 도구 전용 추가 ignore\nprivate-notes/\nai-cache/\n");
    expect(m.isIgnored(`${ROOT}/private-notes`, true)).toBe(true);
    expect(m.isIgnored(`${ROOT}/ai-cache`, true)).toBe(true);
    expect(m.isIgnored(`${ROOT}/node_modules`, true)).toBe(true);
  });
});
