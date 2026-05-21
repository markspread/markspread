// S-KB-008: IME composition guard.

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { _setComposingForTest, attachImeGuard, isComposing } from "./ime";

beforeEach(() => {
  _setComposingForTest(false);
});

afterEach(() => {
  _setComposingForTest(false);
});

describe("isComposing", () => {
  it("returns false by default", () => {
    expect(isComposing()).toBe(false);
  });

  it("returns true when the internal composing flag is set", () => {
    _setComposingForTest(true);
    expect(isComposing()).toBe(true);
  });

  it("returns true when the event reports isComposing", () => {
    const ev = new KeyboardEvent("keydown");
    Object.defineProperty(ev, "isComposing", { value: true });
    expect(isComposing(ev)).toBe(true);
  });

  it("returns true for the legacy keyCode 229 sentinel", () => {
    const ev = new KeyboardEvent("keydown", { keyCode: 229 } as KeyboardEventInit);
    expect(isComposing(ev)).toBe(true);
  });

  it("returns false for an ordinary key event", () => {
    expect(isComposing(new KeyboardEvent("keydown", { key: "a" }))).toBe(false);
  });
});

describe("attachImeGuard", () => {
  it("flips composing on compositionstart and clears it on a microtask after end", async () => {
    const detach = attachImeGuard();
    window.dispatchEvent(new CompositionEvent("compositionstart"));
    expect(isComposing()).toBe(true);
    window.dispatchEvent(new CompositionEvent("compositionend"));
    // Same-tick keydowns still see composing = true.
    expect(isComposing()).toBe(true);
    await Promise.resolve();
    expect(isComposing()).toBe(false);
    detach();
  });

  it("removes the listeners on detach", () => {
    const detach = attachImeGuard();
    detach();
    window.dispatchEvent(new CompositionEvent("compositionstart"));
    expect(isComposing()).toBe(false);
  });

  it("accepts a custom target (document)", () => {
    const detach = attachImeGuard(document);
    document.dispatchEvent(new CompositionEvent("compositionstart"));
    expect(isComposing()).toBe(true);
    detach();
  });
});
