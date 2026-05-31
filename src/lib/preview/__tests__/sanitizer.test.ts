// ADR-0016 (T5.C): Sanitizer 단위 테스트. DOMPurify 는 mock 으로 대체.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { resetSanitizer, sanitize, sanitizeSync, setSanitizer } from "../sanitizer";

interface SanitizeConfig {
  ALLOWED_TAGS: string[];
  ALLOWED_ATTR: string[];
  FORBID_TAGS: string[];
  ALLOW_DATA_ATTR: boolean;
  WHOLE_DOCUMENT: boolean;
  RETURN_TRUSTED_TYPE: boolean;
}

interface CapturedCall {
  input: string;
  config: SanitizeConfig;
}

function makeMock(): {
  mock: {
    sanitize: (input: string, config: SanitizeConfig) => string;
    removed: { element?: { tagName?: string }; attribute?: { name?: string } }[];
  };
  calls: CapturedCall[];
} {
  const calls: CapturedCall[] = [];
  const removed: { element?: { tagName?: string } }[] = [];
  const mock = {
    sanitize(input: string, config: SanitizeConfig) {
      calls.push({ input, config });
      // 단순 모킹 — 입력에 <script 가 있으면 비움.
      removed.length = 0;
      let out = input;
      for (const tag of config.FORBID_TAGS) {
        if (out.includes(`<${tag}`)) {
          removed.push({ element: { tagName: tag.toUpperCase() } });
          out = out.replace(new RegExp(`<${tag}[^>]*>.*?</${tag}>`, "gi"), "");
        }
      }
      return out;
    },
    removed,
  };
  return { mock, calls };
}

function firstCall(calls: CapturedCall[]): CapturedCall {
  const c = calls[0];
  if (!c) throw new Error("expected at least one sanitize call");
  return c;
}

describe("sanitize() — config wiring", () => {
  let calls: CapturedCall[];

  beforeEach(() => {
    const m = makeMock();
    calls = m.calls;
    setSanitizer(m.mock);
  });

  afterEach(() => {
    resetSanitizer();
  });

  it("strict=false (default) includes RELAXED extra tags and data-attr allowed", async () => {
    await sanitize("<p>x</p>", { strict: false });
    expect(calls).toHaveLength(1);
    expect(firstCall(calls).config.ALLOWED_TAGS).toContain("details");
    expect(firstCall(calls).config.ALLOWED_TAGS).toContain("section");
    expect(firstCall(calls).config.ALLOWED_ATTR).toContain("style");
    expect(firstCall(calls).config.ALLOW_DATA_ATTR).toBe(true);
  });

  it("strict=true excludes RELAXED extras, disallows data-attr", async () => {
    await sanitize("<p>x</p>", { strict: true });
    expect(firstCall(calls).config.ALLOWED_TAGS).not.toContain("details");
    expect(firstCall(calls).config.ALLOWED_TAGS).not.toContain("section");
    expect(firstCall(calls).config.ALLOWED_ATTR).not.toContain("style");
    expect(firstCall(calls).config.ALLOW_DATA_ATTR).toBe(false);
  });

  it("always forbids script/iframe/object/embed regardless of mode", async () => {
    for (const strict of [true, false]) {
      calls.length = 0;
      await sanitize("<p>x</p>", { strict });
      expect(firstCall(calls).config.FORBID_TAGS).toEqual(
        expect.arrayContaining(["script", "iframe", "object", "embed"]),
      );
    }
  });

  it("extraAllowedTags / extraAllowedAttrs are merged", async () => {
    await sanitize("<svg/>", {
      strict: true,
      extraAllowedTags: ["svg", "path"],
      extraAllowedAttrs: ["viewBox", "d"],
    });
    expect(firstCall(calls).config.ALLOWED_TAGS).toEqual(expect.arrayContaining(["svg", "path"]));
    expect(firstCall(calls).config.ALLOWED_ATTR).toEqual(expect.arrayContaining(["viewBox", "d"]));
  });

  it("never sets WHOLE_DOCUMENT or RETURN_TRUSTED_TYPE", async () => {
    await sanitize("<p>x</p>");
    expect(firstCall(calls).config.WHOLE_DOCUMENT).toBe(false);
    expect(firstCall(calls).config.RETURN_TRUSTED_TYPE).toBe(false);
  });
});

describe("sanitize() — output shape", () => {
  beforeEach(() => {
    setSanitizer(makeMock().mock);
  });
  afterEach(() => resetSanitizer());

  it("strips forbidden script tag from output", async () => {
    const r = await sanitize("<p>hi</p><script>alert(1)</script>");
    expect(r.html).toBe("<p>hi</p>");
    expect(r.removed).toContain("SCRIPT");
  });

  it("returns empty removed when nothing forbidden present", async () => {
    const r = await sanitize("<p>hi</p>");
    expect(r.removed).toEqual([]);
  });

  it("string-coerces sanitizer output", async () => {
    const r = await sanitize("<p>plain</p>");
    expect(typeof r.html).toBe("string");
  });
});

describe("sanitizeSync()", () => {
  it("throws intentionally — DOMPurify load is async", () => {
    expect(() => sanitizeSync("<p/>")).toThrow(/intentionally unimplemented/);
  });
});

describe("setSanitizer / resetSanitizer", () => {
  it("setSanitizer wins over default loader", async () => {
    const { mock, calls } = makeMock();
    setSanitizer(mock);
    await sanitize("<p>a</p>");
    expect(calls).toHaveLength(1);
    resetSanitizer();
  });
});

describe("getDOMPurify — module-shape handling (node env, no window)", () => {
  afterEach(() => {
    vi.doUnmock("dompurify");
    vi.resetModules();
  });

  it("calls a function default export with `undefined` window (no global window)", async () => {
    // node env → `typeof window === "undefined"` is true (line 129 undefined
    // branch). default IS a function → factory invocation path (127-130).
    vi.resetModules();
    let receivedWindow: unknown = "unset";
    vi.doMock("dompurify", () => ({
      default: (win?: unknown) => {
        receivedWindow = win;
        return {
          sanitize: (input: string) => input.replace(/<script[^>]*>.*?<\/script>/gi, ""),
        };
      },
    }));
    const mod = await import("../sanitizer");
    mod.resetSanitizer();
    const r = await mod.sanitize("<p>x</p><script>bad()</script>");
    expect(receivedWindow).toBeUndefined();
    expect(r.html).toBe("<p>x</p>");
  });

  it("uses the module itself as the instance when there is no default + not a function (line 132)", async () => {
    // No `default` → `(mod).default ?? mod` takes the `?? mod` branch (line 125).
    // The module value is a non-function object exposing `sanitize` → factory is
    // returned as-is (line 132), not invoked.
    vi.resetModules();
    vi.doMock("dompurify", () => ({
      default: undefined,
      sanitize: (input: string) => `clean:${input}`,
      removed: [],
    }));
    const mod = await import("../sanitizer");
    mod.resetSanitizer();
    const r = await mod.sanitize("<p>z</p>");
    expect(r.html).toBe("clean:<p>z</p>");
  });
});

describe("removed-name mapping", () => {
  afterEach(() => resetSanitizer());

  it("falls back to attribute.name when element.tagName is absent", async () => {
    // dom.removed entries can be attribute removals (no element) — exercise
    // the `r.element?.tagName ?? r.attribute?.name` fallback (line 172).
    setSanitizer({
      sanitize: () => "<p></p>",
      removed: [{ attribute: { name: "onclick" } }],
    });
    const r = await sanitize("<p onclick='x'>y</p>");
    expect(r.removed).toEqual(["onclick"]);
  });

  it("treats a missing `removed` array as empty (line 171 branch)", async () => {
    // No `removed` property at all → `dom.removed ?? []` takes the [] branch.
    setSanitizer({ sanitize: () => "<p>clean</p>" });
    const r = await sanitize("<p>clean</p>");
    expect(r.removed).toEqual([]);
  });

  it("drops entries that have neither tagName nor attribute name", async () => {
    setSanitizer({
      sanitize: () => "<p></p>",
      removed: [{}, { element: {} }, { attribute: {} }],
    });
    const r = await sanitize("<p>y</p>");
    expect(r.removed).toEqual([]);
  });
});
