// Unit tests for the per-workspace sidebar/file-tree layout store.

import { beforeEach, describe, expect, it } from "vitest";
import {
  SIDEBAR_DEFAULT_PX,
  SIDEBAR_MAX_PX,
  SIDEBAR_MIN_PX,
  clampSidebarWidth,
  useLayout,
} from "../store/layout";

const WS = "/ws";

beforeEach(() => {
  useLayout.setState({
    sidebarWidth: {},
    sidebarHidden: {},
    sortMode: {},
    foldersFirst: {},
    showHidden: {},
    sidebarCollapsedMode: {},
  });
});

describe("clampSidebarWidth", () => {
  it("clamps below the minimum", () => {
    expect(clampSidebarWidth(10)).toBe(SIDEBAR_MIN_PX);
  });
  it("clamps above the maximum", () => {
    expect(clampSidebarWidth(9999)).toBe(SIDEBAR_MAX_PX);
  });
  it("rounds fractional values", () => {
    expect(clampSidebarWidth(300.7)).toBe(301);
  });
  it("falls back to the default for non-finite input", () => {
    expect(clampSidebarWidth(Number.NaN)).toBe(SIDEBAR_DEFAULT_PX);
  });
});

describe("layout store - sidebar width", () => {
  it("returns the default when unset", () => {
    expect(useLayout.getState().getSidebarWidth(WS)).toBe(SIDEBAR_DEFAULT_PX);
  });

  it("stores a clamped width", () => {
    useLayout.getState().setSidebarWidth(WS, 9999);
    expect(useLayout.getState().getSidebarWidth(WS)).toBe(SIDEBAR_MAX_PX);
  });

  it("setSidebarWidth is a no-op when the clamped value is unchanged", () => {
    useLayout.getState().setSidebarWidth(WS, 300);
    const before = useLayout.getState().sidebarWidth;
    useLayout.getState().setSidebarWidth(WS, 300);
    expect(useLayout.getState().sidebarWidth).toBe(before);
  });

  it("re-clamps an out-of-range persisted width on read", () => {
    useLayout.setState({ sidebarWidth: { [WS]: 99999 } });
    expect(useLayout.getState().getSidebarWidth(WS)).toBe(SIDEBAR_MAX_PX);
  });
});

describe("layout store - sidebar hidden", () => {
  it("defaults to visible", () => {
    expect(useLayout.getState().isSidebarHidden(WS)).toBe(false);
  });

  it("setSidebarHidden toggles the flag", () => {
    useLayout.getState().setSidebarHidden(WS, true);
    expect(useLayout.getState().isSidebarHidden(WS)).toBe(true);
  });

  it("setSidebarHidden is a no-op when unchanged", () => {
    const before = useLayout.getState().sidebarHidden;
    useLayout.getState().setSidebarHidden(WS, false);
    expect(useLayout.getState().sidebarHidden).toBe(before);
  });

  it("toggleSidebar flips the hidden state", () => {
    useLayout.getState().toggleSidebar(WS);
    expect(useLayout.getState().isSidebarHidden(WS)).toBe(true);
    useLayout.getState().toggleSidebar(WS);
    expect(useLayout.getState().isSidebarHidden(WS)).toBe(false);
  });
});

describe("layout store - sort mode", () => {
  it("defaults to name", () => {
    expect(useLayout.getState().getSortMode(WS)).toBe("name");
  });

  it("setSortMode stores a mode", () => {
    useLayout.getState().setSortMode(WS, "modified");
    expect(useLayout.getState().getSortMode(WS)).toBe("modified");
  });

  it("setSortMode is a no-op when unchanged", () => {
    useLayout.getState().setSortMode(WS, "type");
    const before = useLayout.getState().sortMode;
    useLayout.getState().setSortMode(WS, "type");
    expect(useLayout.getState().sortMode).toBe(before);
  });
});

describe("layout store - folders first", () => {
  it("defaults to true", () => {
    expect(useLayout.getState().isFoldersFirst(WS)).toBe(true);
  });

  it("setFoldersFirst can disable it once an explicit value is present", () => {
    // The store's guard treats the unset default as `true`, so disabling
    // requires an explicit persisted value first.
    useLayout.setState({ foldersFirst: { [WS]: true } });
    useLayout.getState().setFoldersFirst(WS, false);
    expect(useLayout.getState().isFoldersFirst(WS)).toBe(false);
  });

  it("respects an explicit persisted false", () => {
    useLayout.setState({ foldersFirst: { [WS]: false } });
    expect(useLayout.getState().isFoldersFirst(WS)).toBe(false);
  });

  it("setFoldersFirst is a no-op when unchanged", () => {
    useLayout.getState().setFoldersFirst(WS, false);
    const before = useLayout.getState().foldersFirst;
    useLayout.getState().setFoldersFirst(WS, false);
    expect(useLayout.getState().foldersFirst).toBe(before);
  });
});

describe("layout store - show hidden", () => {
  it("defaults to false", () => {
    expect(useLayout.getState().isShowHidden(WS)).toBe(false);
  });

  it("setShowHidden toggles the flag", () => {
    useLayout.getState().setShowHidden(WS, true);
    expect(useLayout.getState().isShowHidden(WS)).toBe(true);
  });

  it("setShowHidden is a no-op when unchanged", () => {
    const before = useLayout.getState().showHidden;
    useLayout.getState().setShowHidden(WS, false);
    expect(useLayout.getState().showHidden).toBe(before);
  });

  it("toggleShowHidden flips the flag", () => {
    useLayout.getState().toggleShowHidden(WS);
    expect(useLayout.getState().isShowHidden(WS)).toBe(true);
    useLayout.getState().toggleShowHidden(WS);
    expect(useLayout.getState().isShowHidden(WS)).toBe(false);
  });
});

describe("layout store - collapsed mode", () => {
  it("defaults to rail", () => {
    expect(useLayout.getState().getSidebarCollapsedMode(WS)).toBe("rail");
  });

  it("setSidebarCollapsedMode stores a mode", () => {
    useLayout.getState().setSidebarCollapsedMode(WS, "hidden");
    expect(useLayout.getState().getSidebarCollapsedMode(WS)).toBe("hidden");
  });

  it("setSidebarCollapsedMode is a no-op when unchanged", () => {
    useLayout.getState().setSidebarCollapsedMode(WS, "hidden");
    const before = useLayout.getState().sidebarCollapsedMode;
    useLayout.getState().setSidebarCollapsedMode(WS, "hidden");
    expect(useLayout.getState().sidebarCollapsedMode).toBe(before);
  });
});
