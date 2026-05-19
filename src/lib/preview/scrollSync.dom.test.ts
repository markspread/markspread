// Coverage for the editor/preview scroll sync registry.

import { afterEach, describe, expect, it, vi } from "vitest";
import {
  type ScrollSyncEvent,
  emitScroll,
  isScrollSyncEnabled,
  onScroll,
  setScrollSyncEnabled,
  suppressEcho,
} from "./scrollSync";

const EVT: ScrollSyncEvent = { side: "editor", topLine: 4, fraction: 0.2 };

afterEach(() => {
  setScrollSyncEnabled(true);
  vi.useRealTimers();
});

describe("scrollSync", () => {
  it("is enabled by default and toggles via setScrollSyncEnabled", () => {
    expect(isScrollSyncEnabled()).toBe(true);
    setScrollSyncEnabled(false);
    expect(isScrollSyncEnabled()).toBe(false);
    setScrollSyncEnabled(true);
    expect(isScrollSyncEnabled()).toBe(true);
  });

  it("delivers emitted events to subscribers", () => {
    const fn = vi.fn();
    const off = onScroll(fn);
    emitScroll(EVT);
    expect(fn).toHaveBeenCalledWith(EVT);
    off();
  });

  it("stops delivering after unsubscribe", () => {
    const fn = vi.fn();
    const off = onScroll(fn);
    off();
    emitScroll(EVT);
    expect(fn).not.toHaveBeenCalled();
  });

  it("does not emit when disabled", () => {
    const fn = vi.fn();
    const off = onScroll(fn);
    setScrollSyncEnabled(false);
    emitScroll(EVT);
    expect(fn).not.toHaveBeenCalled();
    off();
  });

  it("suppresses events for the echo window", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(1_000_000));
    const fn = vi.fn();
    const off = onScroll(fn);
    suppressEcho(80);
    emitScroll(EVT);
    expect(fn).not.toHaveBeenCalled();
    vi.setSystemTime(new Date(1_000_000 + 81));
    emitScroll(EVT);
    expect(fn).toHaveBeenCalledTimes(1);
    off();
  });

  it("suppressEcho keeps the longer of competing windows", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2_000_000));
    const fn = vi.fn();
    const off = onScroll(fn);
    suppressEcho(200);
    suppressEcho(10); // shorter — must not shrink the window
    vi.setSystemTime(new Date(2_000_000 + 50));
    emitScroll(EVT);
    expect(fn).not.toHaveBeenCalled();
    off();
  });

  it("suppressEcho uses an 80ms default", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(3_000_000));
    const fn = vi.fn();
    const off = onScroll(fn);
    suppressEcho();
    vi.setSystemTime(new Date(3_000_000 + 79));
    emitScroll(EVT);
    expect(fn).not.toHaveBeenCalled();
    off();
  });
});
