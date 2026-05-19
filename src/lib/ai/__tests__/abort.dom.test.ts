// S-AI-027: ESC-abort registry coverage.

import { afterEach, describe, expect, it, vi } from "vitest";
import { aiAbortRegistry, mountAbortHotkey } from "../abort";

afterEach(() => {
  aiAbortRegistry.abortAll();
});

describe("aiAbortRegistry", () => {
  it("counts registered streams", () => {
    aiAbortRegistry.register("a", new AbortController());
    aiAbortRegistry.register("b", new AbortController());
    expect(aiAbortRegistry.count()).toBe(2);
  });

  it("finish removes a stream from the registry", () => {
    aiAbortRegistry.register("a", new AbortController());
    aiAbortRegistry.finish("a");
    expect(aiAbortRegistry.count()).toBe(0);
  });

  it("abortAll aborts each controller and returns the count", () => {
    const c1 = new AbortController();
    const c2 = new AbortController();
    aiAbortRegistry.register("a", c1);
    aiAbortRegistry.register("b", c2);
    expect(aiAbortRegistry.abortAll()).toBe(2);
    expect(c1.signal.aborted).toBe(true);
    expect(c2.signal.aborted).toBe(true);
    expect(aiAbortRegistry.count()).toBe(0);
  });

  it("abortAll skips already-aborted controllers in its count", () => {
    const c1 = new AbortController();
    c1.abort();
    aiAbortRegistry.register("a", c1);
    expect(aiAbortRegistry.abortAll()).toBe(0);
  });

  it("abortOne aborts a known stream and returns true", () => {
    const c = new AbortController();
    aiAbortRegistry.register("a", c);
    expect(aiAbortRegistry.abortOne("a")).toBe(true);
    expect(c.signal.aborted).toBe(true);
  });

  it("abortOne returns false for an unknown id", () => {
    expect(aiAbortRegistry.abortOne("missing")).toBe(false);
  });
});

describe("mountAbortHotkey", () => {
  it("aborts active streams on Escape", () => {
    const c = new AbortController();
    aiAbortRegistry.register("a", c);
    const unmount = mountAbortHotkey();
    document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
    expect(c.signal.aborted).toBe(true);
    unmount();
  });

  it("ignores non-Escape keys", () => {
    const c = new AbortController();
    aiAbortRegistry.register("a", c);
    const unmount = mountAbortHotkey();
    document.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter" }));
    expect(c.signal.aborted).toBe(false);
    unmount();
  });

  it("the returned cleanup detaches the listener", () => {
    const spy = vi.spyOn(document, "removeEventListener");
    const unmount = mountAbortHotkey();
    unmount();
    expect(spy).toHaveBeenCalledWith("keydown", expect.any(Function), true);
  });
});
