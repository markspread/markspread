// @vitest-environment node
//
// Covers BOTH arms of the `typeof Range !== "undefined"` guard in
// jsdomLayoutShim within a single worker. v8 coverage merges branch data
// per-worker, so exercising both arms here guarantees the guard hits 100%
// regardless of how the sibling jsdom test is scheduled.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

describe("jsdomLayoutShim — Range guard", () => {
  beforeEach(() => {
    vi.resetModules();
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.resetModules();
  });

  it("installs nothing when Range is undefined (false arm)", async () => {
    vi.stubGlobal("Range", undefined);
    expect((globalThis as { Range?: unknown }).Range).toBeUndefined();
    await expect(import("./jsdomLayoutShim")).resolves.toBeDefined();
    // No prototype patched — Range stays undefined.
    expect((globalThis as { Range?: unknown }).Range).toBeUndefined();
  });

  it("patches Range.prototype when Range exists (true arm)", async () => {
    // Provide a minimal Range stand-in so the guard's true arm runs in a
    // node environment too, keeping both branches inside one worker.
    class FakeRange {
      getClientRects(): unknown {
        return undefined;
      }
      getBoundingClientRect(): unknown {
        return undefined;
      }
    }
    vi.stubGlobal("Range", FakeRange);
    await import("./jsdomLayoutShim");
    const rects = new FakeRange().getClientRects() as { length: number; item: (i: number) => null };
    expect(rects.length).toBe(0);
    expect(rects.item(0)).toBeNull();
    const collected: unknown[] = [];
    for (const r of rects as unknown as Iterable<unknown>) collected.push(r);
    expect(collected).toEqual([]);
    const rect = new FakeRange().getBoundingClientRect() as {
      width: number;
      toJSON: () => unknown;
    };
    expect(rect.width).toBe(0);
    expect(rect.toJSON()).toEqual({});
  });
});
