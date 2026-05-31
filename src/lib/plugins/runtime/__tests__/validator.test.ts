// ADR-0016 (T5.B): Validator (AST/text 정적 분석) 단위 테스트.

import { describe, expect, it } from "vitest";
import { analyse, isClean } from "../validator";

describe("Validator — basic detection", () => {
  it("clean source returns no violations", () => {
    expect(analyse("export function md(s){ return s.toUpperCase() }")).toEqual([]);
    expect(isClean("export function md(s){ return s.toUpperCase() }")).toBe(true);
  });

  it("detects eval()", () => {
    const [first, ...rest] = analyse("function bad(x){ eval(x) }");
    expect(rest).toHaveLength(0);
    if (!first) throw new Error("expected one violation");
    expect(first.code).toBe("eval");
    expect(first.snippet).toMatch(/eval\s*\(/);
    expect(first.span.line).toBe(1);
  });

  it("detects new Function()", () => {
    const v = analyse("const f = new Function('x', 'return x+1');");
    expect(v.some((x) => x.code === "new_function")).toBe(true);
  });

  it("detects document.write and document.writeln", () => {
    const v = analyse("document.write('<x>');\ndocument.writeln('<y>')");
    expect(v.filter((x) => x.code === "document_write")).toHaveLength(2);
  });

  it("detects innerHTML assignment", () => {
    const v = analyse("el.innerHTML = userInput;");
    expect(v.some((x) => x.code === "innerhtml_assign")).toBe(true);
  });

  it("detects fetch() and XMLHttpRequest", () => {
    const v = analyse("fetch('/x'); const x = new XMLHttpRequest();");
    expect(v.some((x) => x.code === "network_fetch")).toBe(true);
    expect(v.some((x) => x.code === "network_xhr")).toBe(true);
  });

  it("detects infinite loop heuristics", () => {
    const v = analyse("while(true){ work() }\nfor(;;){}");
    expect(v.filter((x) => x.code === "infinite_loop")).toHaveLength(2);
  });

  it("reports correct line/column for multi-line", () => {
    const src = "// header\nfunction f(){\n  eval('bad')\n}";
    const [first, ...rest] = analyse(src);
    expect(rest).toHaveLength(0);
    if (!first) throw new Error("expected one violation");
    expect(first.span.line).toBe(3);
    expect(first.span.column).toBe(3); // 0-indexed 2 → 1-indexed 3 (after two spaces)
  });

  it("reports multiple violations of same rule", () => {
    const v = analyse("eval(a); eval(b); eval(c);");
    expect(v.filter((x) => x.code === "eval")).toHaveLength(3);
  });
});

describe("Validator — allow override", () => {
  it("allow set suppresses matching violations", () => {
    const v = analyse("fetch('/x'); eval(y);", { allow: new Set(["network_fetch"]) });
    const codes = v.map((x) => x.code);
    expect(codes).toContain("eval");
    expect(codes).not.toContain("network_fetch");
  });

  it("isClean respects allow set", () => {
    expect(isClean("fetch('/x')", { allow: new Set(["network_fetch"]) })).toBe(true);
    expect(isClean("fetch('/x')")).toBe(false);
  });

  it("allowing all rules makes any source clean", () => {
    const allow = new Set<
      | "eval"
      | "new_function"
      | "document_write"
      | "innerhtml_assign"
      | "network_fetch"
      | "network_xhr"
      | "infinite_loop"
    >([
      "eval",
      "new_function",
      "document_write",
      "innerhtml_assign",
      "network_fetch",
      "network_xhr",
      "infinite_loop",
    ]);
    expect(isClean("eval(x); fetch(y); new Function('z');", { allow })).toBe(true);
  });
});

describe("Validator — false positive sensitivity", () => {
  it("ignores eval inside string literal — known limitation, documented", () => {
    // 본 구현은 text-level regex 라서 string 내부의 'eval(' 도 match.
    // 의도된 false positive. AST 도입 시 개선.
    const v = analyse("const msg = 'eval(x) is bad';");
    expect(v.some((x) => x.code === "eval")).toBe(true);
  });

  it("ignores variable named 'eval2' (word boundary)", () => {
    const v = analyse("const eval2 = 1; eval2;");
    expect(v.some((x) => x.code === "eval")).toBe(false);
  });

  it("ignores .innerText (innerHTML word boundary)", () => {
    const v = analyse("el.innerText = x; el.appendInnerHTMLNot = y;");
    expect(v.some((x) => x.code === "innerhtml_assign")).toBe(false);
  });
});

describe("Validator — multi-rule stability", () => {
  it("does not skip rules after first match (regex.lastIndex reset)", () => {
    const src1 = "eval(1)";
    const src2 = "fetch('/')";
    expect(isClean(src1)).toBe(false);
    expect(isClean(src2)).toBe(false);
    // re-call to ensure regex state didn't leak
    expect(isClean(src1)).toBe(false);
    expect(isClean(src2)).toBe(false);
  });
});
