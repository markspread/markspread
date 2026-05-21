// S-KB-002: keyboard layout label resolution coverage.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { codeFromKeySegment, labelForCode, onLayoutChange } from "./layout";

type LayoutMap = Map<string, string>;

interface KeyboardStub {
  getLayoutMap?: () => Promise<LayoutMap>;
  addEventListener?: (type: string, listener: () => void) => void;
  removeEventListener?: (type: string, listener: () => void) => void;
}

const originalKeyboard = (navigator as unknown as { keyboard?: unknown }).keyboard;

function setKeyboard(stub: KeyboardStub | undefined): void {
  Object.defineProperty(navigator, "keyboard", {
    value: stub,
    configurable: true,
    writable: true,
  });
}

beforeEach(async () => {
  setKeyboard(undefined);
  // Reset the module-level cache by re-importing.
  vi.resetModules();
});

afterEach(() => {
  if (originalKeyboard) setKeyboard(originalKeyboard as KeyboardStub);
  else setKeyboard(undefined);
});

describe("loadLayoutMap", () => {
  it("is a no-op when navigator.keyboard is absent", async () => {
    const { loadLayoutMap: load, labelForCode: label } = await import("./layout");
    await load();
    expect(label("KeyA")).toBe("A");
  });

  it("populates the cache from getLayoutMap when available", async () => {
    setKeyboard({ getLayoutMap: () => Promise.resolve(new Map([["KeyA", "q"]])) });
    const { loadLayoutMap: load, labelForCode: label } = await import("./layout");
    await load();
    expect(label("KeyA")).toBe("Q");
  });

  it("returns early when the cache is already populated", async () => {
    const getMap = vi.fn(() => Promise.resolve(new Map([["KeyA", "x"]])));
    setKeyboard({ getLayoutMap: getMap });
    const { loadLayoutMap: load } = await import("./layout");
    await load();
    await load();
    expect(getMap).toHaveBeenCalledTimes(1);
  });

  it("reuses the in-flight promise when called concurrently", async () => {
    let resolve!: (m: LayoutMap) => void;
    const getMap = vi.fn(
      () =>
        new Promise<LayoutMap>((r) => {
          resolve = r as (m: LayoutMap) => void;
        }),
    );
    setKeyboard({ getLayoutMap: getMap });
    const { loadLayoutMap: load } = await import("./layout");
    const a = load();
    const b = load();
    resolve(new Map());
    await Promise.all([a, b]);
    expect(getMap).toHaveBeenCalledTimes(1);
  });

  it("swallows getLayoutMap errors and leaves the cache empty", async () => {
    setKeyboard({ getLayoutMap: () => Promise.reject(new Error("nope")) });
    const { loadLayoutMap: load, labelForCode: label } = await import("./layout");
    await load();
    expect(label("KeyA")).toBe("A");
  });
});

describe("onLayoutChange", () => {
  it("returns a no-op unsubscribe when keyboard events are unavailable", () => {
    setKeyboard(undefined);
    expect(typeof onLayoutChange(() => {})).toBe("function");
  });

  it("wires a layoutchange listener that re-loads the cache", async () => {
    const handler = vi.fn();
    let fire: (() => void) | undefined;
    setKeyboard({
      getLayoutMap: () => Promise.resolve(new Map()),
      addEventListener: (_t, listener) => {
        fire = listener;
      },
      removeEventListener: vi.fn(),
    });
    const { onLayoutChange: subscribe } = await import("./layout");
    const off = subscribe(handler);
    expect(fire).toBeDefined();
    fire?.();
    for (let i = 0; i < 5; i += 1) await Promise.resolve();
    expect(handler).toHaveBeenCalled();
    off();
  });
});

describe("labelForCode", () => {
  it("returns the empty string for an empty code", () => {
    expect(labelForCode("")).toBe("");
  });

  it("strips the 'Key' prefix for letter codes", () => {
    expect(labelForCode("KeyA")).toBe("A");
  });

  it("strips the 'Digit' prefix for digit codes", () => {
    expect(labelForCode("Digit1")).toBe("1");
  });

  it("translates punctuation codes to their printed glyph", () => {
    expect(labelForCode("Slash")).toBe("/");
    expect(labelForCode("Backslash")).toBe("\\");
    expect(labelForCode("Backquote")).toBe("`");
    expect(labelForCode("Minus")).toBe("-");
    expect(labelForCode("Equal")).toBe("=");
    expect(labelForCode("Comma")).toBe(",");
    expect(labelForCode("Period")).toBe(".");
    expect(labelForCode("Semicolon")).toBe(";");
    expect(labelForCode("Quote")).toBe("'");
    expect(labelForCode("BracketLeft")).toBe("[");
    expect(labelForCode("BracketRight")).toBe("]");
  });

  it("falls back to the raw code for unknown special keys", () => {
    expect(labelForCode("F12")).toBe("F12");
  });
});

describe("codeFromKeySegment", () => {
  it("maps a single uppercase letter to its Key code", () => {
    expect(codeFromKeySegment("A")).toBe("KeyA");
  });

  it("maps a single digit to its Digit code", () => {
    expect(codeFromKeySegment("5")).toBe("Digit5");
  });

  it("maps known punctuation glyphs to their code names", () => {
    expect(codeFromKeySegment("/")).toBe("Slash");
    expect(codeFromKeySegment("\\")).toBe("Backslash");
    expect(codeFromKeySegment("`")).toBe("Backquote");
    expect(codeFromKeySegment("-")).toBe("Minus");
    expect(codeFromKeySegment("=")).toBe("Equal");
    expect(codeFromKeySegment(",")).toBe("Comma");
    expect(codeFromKeySegment(".")).toBe("Period");
    expect(codeFromKeySegment(";")).toBe("Semicolon");
    expect(codeFromKeySegment("'")).toBe("Quote");
    expect(codeFromKeySegment("[")).toBe("BracketLeft");
    expect(codeFromKeySegment("]")).toBe("BracketRight");
  });

  it("passes unknown segments through unchanged", () => {
    expect(codeFromKeySegment("Enter")).toBe("Enter");
  });
});
