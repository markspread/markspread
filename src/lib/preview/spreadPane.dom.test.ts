// Coverage for the Spread Pane host state.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  type SpreadTab,
  getSpreadPaneState,
  registerSpreadTab,
  restoreSpreadPane,
  serializeSpreadPane,
  setActiveSpreadTab,
  setSpreadPaneRatio,
  setSpreadPaneVisible,
  subscribeSpreadPane,
  toggleSpreadPane,
} from "./spreadPane";

function makeTab(id: string): SpreadTab {
  return { id, labelKey: `tab.${id}`, render: () => null };
}

// spreadPane keeps module-level state, so each registered tab is
// tracked and torn down after the test to keep cases isolated.
const disposers: Array<() => void> = [];
function track(dispose: () => void): () => void {
  disposers.push(dispose);
  return dispose;
}

beforeEach(() => {
  restoreSpreadPane({ visible: true, ratio: 0.45, activeTab: "preview" });
});

afterEach(() => {
  for (const d of disposers.splice(0)) d();
  restoreSpreadPane({ visible: true, ratio: 0.45, activeTab: "preview" });
});

describe("spreadPane state", () => {
  it("exposes a default state", () => {
    const s = getSpreadPaneState();
    expect(s.visible).toBe(true);
    expect(s.ratio).toBe(0.45);
    expect(s.activeTab).toBe("preview");
  });

  it("setSpreadPaneVisible changes visibility and notifies", () => {
    const fn = vi.fn();
    const off = subscribeSpreadPane(fn);
    setSpreadPaneVisible(false);
    expect(getSpreadPaneState().visible).toBe(false);
    expect(fn).toHaveBeenCalledTimes(1);
    off();
  });

  it("setSpreadPaneVisible no-ops when value is unchanged", () => {
    const fn = vi.fn();
    const off = subscribeSpreadPane(fn);
    setSpreadPaneVisible(true);
    expect(fn).not.toHaveBeenCalled();
    off();
  });

  it("toggleSpreadPane flips visibility", () => {
    toggleSpreadPane();
    expect(getSpreadPaneState().visible).toBe(false);
    toggleSpreadPane();
    expect(getSpreadPaneState().visible).toBe(true);
  });

  it("setSpreadPaneRatio clamps to [0.15, 0.85]", () => {
    setSpreadPaneRatio(0.5);
    expect(getSpreadPaneState().ratio).toBe(0.5);
    setSpreadPaneRatio(0);
    expect(getSpreadPaneState().ratio).toBe(0.15);
    setSpreadPaneRatio(1);
    expect(getSpreadPaneState().ratio).toBe(0.85);
  });

  it("registerSpreadTab adds a tab and returns a disposer", () => {
    const dispose = track(registerSpreadTab(makeTab("outline")));
    expect(getSpreadPaneState().tabs.map((t) => t.id)).toContain("outline");
    dispose();
    expect(getSpreadPaneState().tabs.map((t) => t.id)).not.toContain("outline");
  });

  it("registerSpreadTab ignores duplicate ids", () => {
    track(registerSpreadTab(makeTab("dup")));
    const before = getSpreadPaneState().tabs.length;
    const noop = registerSpreadTab(makeTab("dup"));
    expect(getSpreadPaneState().tabs.length).toBe(before);
    noop();
    // disposer is a no-op — the original tab survives.
    expect(getSpreadPaneState().tabs.map((t) => t.id)).toContain("dup");
  });

  it("setActiveSpreadTab switches to a registered tab", () => {
    track(registerSpreadTab(makeTab("diff")));
    setActiveSpreadTab("diff");
    expect(getSpreadPaneState().activeTab).toBe("diff");
  });

  it("setActiveSpreadTab ignores unregistered tab ids", () => {
    setActiveSpreadTab("ghost");
    expect(getSpreadPaneState().activeTab).toBe("preview");
  });

  it("setActiveSpreadTab no-ops when already active", () => {
    const fn = vi.fn();
    const off = subscribeSpreadPane(fn);
    setActiveSpreadTab("preview");
    expect(fn).not.toHaveBeenCalled();
    off();
  });

  it("disposing the active tab falls back to the first remaining tab", () => {
    const d1 = registerSpreadTab(makeTab("first"));
    track(registerSpreadTab(makeTab("second")));
    setActiveSpreadTab("first");
    d1();
    expect(getSpreadPaneState().activeTab).toBe("second");
  });

  it("disposing the only/active tab falls back to 'preview'", () => {
    const d = registerSpreadTab(makeTab("solo"));
    setActiveSpreadTab("solo");
    d();
    expect(getSpreadPaneState().activeTab).toBe("preview");
  });

  it("serializeSpreadPane returns the persisted subset", () => {
    setSpreadPaneRatio(0.6);
    const snap = serializeSpreadPane();
    expect(snap).toEqual({ visible: true, ratio: 0.6, activeTab: "preview" });
  });

  it("restoreSpreadPane applies a partial snapshot", () => {
    restoreSpreadPane({ ratio: 0.7 });
    expect(getSpreadPaneState().ratio).toBe(0.7);
    expect(getSpreadPaneState().visible).toBe(true);
  });

  it("restoreSpreadPane keeps current values for missing fields", () => {
    setSpreadPaneVisible(false);
    restoreSpreadPane({});
    expect(getSpreadPaneState().visible).toBe(false);
  });

  it("subscribeSpreadPane disposer removes the listener", () => {
    const fn = vi.fn();
    const off = subscribeSpreadPane(fn);
    off();
    setSpreadPaneVisible(false);
    expect(fn).not.toHaveBeenCalled();
  });
});
