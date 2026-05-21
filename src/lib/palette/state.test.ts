// S-TST: palette open/close state machine.

import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  closePalette,
  getPaletteState,
  openPalette,
  subscribePalette,
  togglePalette,
} from "./state";

beforeEach(() => {
  closePalette();
});

describe("palette state", () => {
  it("opens with the requested mode and notifies subscribers", () => {
    const fn = vi.fn();
    const unsub = subscribePalette(fn);
    openPalette("file");
    expect(getPaletteState()).toEqual({ open: true, mode: "file" });
    expect(fn).toHaveBeenCalled();
    unsub();
  });

  it("defaults openPalette mode to 'all'", () => {
    openPalette();
    expect(getPaletteState().mode).toBe("all");
  });

  it("closePalette is a no-op when already closed", () => {
    const fn = vi.fn();
    subscribePalette(fn);
    closePalette();
    closePalette();
    expect(fn).not.toHaveBeenCalled();
  });

  it("togglePalette closes when the open mode matches", () => {
    openPalette("file");
    togglePalette("file");
    expect(getPaletteState().open).toBe(false);
  });

  it("togglePalette switches modes when the open mode differs", () => {
    openPalette("file");
    togglePalette("all");
    expect(getPaletteState()).toEqual({ open: true, mode: "all" });
  });

  it("togglePalette opens with the default mode when closed", () => {
    togglePalette();
    expect(getPaletteState()).toEqual({ open: true, mode: "all" });
  });

  it("subscribe returns an unsubscribe that detaches the listener", () => {
    const fn = vi.fn();
    const unsub = subscribePalette(fn);
    unsub();
    openPalette("all");
    expect(fn).not.toHaveBeenCalled();
  });
});
