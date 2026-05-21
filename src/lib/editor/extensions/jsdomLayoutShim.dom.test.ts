import "./jsdomLayoutShim";
import { describe, expect, it } from "vitest";

describe("jsdomLayoutShim", () => {
  it("returns an empty DOMRectList from getClientRects with a working iterator", () => {
    const range = document.createRange();
    const rects = range.getClientRects();
    expect(rects.length).toBe(0);
    expect(rects.item(0)).toBeNull();
    // Iterating the shimmed list exercises the generator body so it doesn't
    // sit as dead code for v8 coverage.
    const collected: unknown[] = [];
    for (const r of rects as unknown as Iterable<unknown>) collected.push(r);
    expect(collected).toEqual([]);
  });

  it("returns an empty DOMRect from getBoundingClientRect", () => {
    const rect = document.createRange().getBoundingClientRect();
    expect(rect.width).toBe(0);
    expect(rect.height).toBe(0);
    expect(rect.toJSON()).toEqual({});
  });
});
