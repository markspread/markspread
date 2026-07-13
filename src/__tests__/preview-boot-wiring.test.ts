// SC-BASE-02 / SC-BASE-05: bootstrap wiring guard.
//
// The R1 defect class behind F5/F8 was "module complete, unit tests
// green, bootstrap never calls it" — mermaid/shiki registration had
// zero production callers, so unit suites stayed green while the app
// shipped dead features. boot.dom.test.ts covers the boot module's
// behaviour; this suite pins the two seams a unit test can't see:
//   1. main.tsx actually imports lib/preview/boot and invokes it, and
//   2. styles.css maps the dual-theme `--shiki-*` token variables that
//      the highlighter output depends on (defaultColor: false).
// main.tsx is excluded from vitest coverage (it mounts the app), so a
// source-level assertion is the cheapest honest check — same pattern as
// z-index-tokens.test.ts.

import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("preview runtime bootstrap wiring", () => {
  it("main.tsx lazily imports the preview boot module and invokes it", () => {
    const src = readFileSync(new URL("../main.tsx", import.meta.url), "utf-8");
    expect(src).toContain('import("./lib/preview/boot")');
    expect(src).toContain("bootPreviewRuntime()");
  });

  it("styles.css maps the shiki dual-theme token variables", () => {
    const css = readFileSync(new URL("../styles.css", import.meta.url), "utf-8");
    expect(css).toContain("var(--shiki-light)");
    expect(css).toContain("var(--shiki-dark)");
    // dark side must be reachable via both the explicit override and the
    // OS preference (S-TY-010 theme model).
    expect(css).toContain('html[data-theme="dark"] .shiki');
    expect(css).toMatch(/prefers-color-scheme: dark[\s\S]*--shiki-dark/);
  });
});
