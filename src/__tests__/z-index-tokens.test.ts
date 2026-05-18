// S-SBP-008: locks the z-index token ordering so a careless edit in
// styles.css can't quietly invert the stacking story (e.g., pushing
// peek above palette). Reads the CSS file directly so the test
// validates the actual source, not a stale copy of the constants.

import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

function parseToken(css: string, name: string): number {
  const re = new RegExp(`${name}\\s*:\\s*(\\d+)\\s*;`);
  const match = css.match(re);
  if (!match || match[1] == null) {
    throw new Error(`token ${name} not found in styles.css`);
  }
  return Number.parseInt(match[1], 10);
}

describe("z-index tokens", () => {
  const css = readFileSync(new URL("../styles.css", import.meta.url), "utf-8");
  const peek = parseToken(css, "--z-peek");
  const palette = parseToken(css, "--z-palette");
  const sheet = parseToken(css, "--z-sheet");
  const dialog = parseToken(css, "--z-dialog");
  const toast = parseToken(css, "--z-toast");

  it("peek sits below the command palette", () => {
    expect(palette).toBeGreaterThan(peek);
  });

  it("settings sheet sits above peek and palette", () => {
    expect(sheet).toBeGreaterThan(palette);
    expect(sheet).toBeGreaterThan(peek);
  });

  it("sub-dialogs sit above the sheet they were launched from", () => {
    expect(dialog).toBeGreaterThan(sheet);
  });

  it("toasts win against every other overlay", () => {
    expect(toast).toBeGreaterThan(dialog);
    expect(toast).toBeGreaterThan(sheet);
    expect(toast).toBeGreaterThan(palette);
    expect(toast).toBeGreaterThan(peek);
  });
});
