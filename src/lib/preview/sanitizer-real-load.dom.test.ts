// ADR-0016 (T5.C): exercise the *real* DOMPurify lazy-load path of
// sanitizer.ts (getDOMPurify dynamic import + factory invocation, lines
// 120-134). This must run in jsdom so `window` exists and the imported
// DOMPurify factory produces a usable instance — the node unit test uses a
// mock via setSanitizer() and never touches the dynamic import.

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { resetSanitizer, sanitize } from "./sanitizer";

describe("sanitizer — real DOMPurify lazy load", () => {
  beforeEach(() => resetSanitizer());
  afterEach(() => resetSanitizer());

  it("dynamic-imports dompurify on first call and sanitises dangerous tags", async () => {
    // cachedDom is null → getDOMPurify hits the real `import("dompurify")`
    // branch (lines 121-134) and the `typeof factory === "function"` path.
    const r = await sanitize("<p>hi</p><script>alert(1)</script>", { strict: true });
    expect(typeof r.html).toBe("string");
    expect(r.html).not.toMatch(/<script/i);
    expect(r.html).toContain("hi");
  });

  it("reuses the cached promise on a second call (line 120 false branch)", async () => {
    await sanitize("<p>first</p>");
    // cachedDom is now set → second call skips the import block.
    const r = await sanitize("<p>second</p>");
    expect(r.html).toContain("second");
  });
});
