// S-TST: sidebar commands — toggle/show/hide/peek/hidden-files, all
// scoped to the current workspace.

import { beforeEach, describe, expect, it } from "vitest";
import { useLayout } from "../../store/layout";
import { useSidebarPeek } from "../../store/sidebar-peek";
import { useWorkspace } from "../../store/workspace";
import {
  hideSidebarCommand,
  peekSidebarCommand,
  showSidebarCommand,
  toggleHiddenFilesCommand,
  toggleSidebarCommand,
} from "./sidebar";

const WS = "/ws";

beforeEach(() => {
  useWorkspace.setState({ current: null, readOnly: false });
  useLayout.setState({
    sidebarWidth: {},
    sidebarHidden: {},
    sortMode: {},
    foldersFirst: {},
    showHidden: {},
    sidebarCollapsedMode: {},
  });
  useSidebarPeek.setState({ open: false, pinned: false, restoreFocusEl: null });
});

describe("toggleSidebarCommand", () => {
  it("no-ops without a workspace", () => {
    toggleSidebarCommand();
    expect(useLayout.getState().sidebarHidden).toEqual({});
  });

  it("flips the per-workspace sidebar hidden state", () => {
    useWorkspace.setState({ current: WS, readOnly: false });
    toggleSidebarCommand();
    expect(useLayout.getState().isSidebarHidden(WS)).toBe(true);
    toggleSidebarCommand();
    expect(useLayout.getState().isSidebarHidden(WS)).toBe(false);
  });
});

describe("showSidebarCommand / hideSidebarCommand", () => {
  it("no-op without a workspace", () => {
    showSidebarCommand();
    hideSidebarCommand();
    expect(useLayout.getState().sidebarHidden).toEqual({});
  });

  it("explicitly set the hidden flag", () => {
    useWorkspace.setState({ current: WS, readOnly: false });
    hideSidebarCommand();
    expect(useLayout.getState().isSidebarHidden(WS)).toBe(true);
    showSidebarCommand();
    expect(useLayout.getState().isSidebarHidden(WS)).toBe(false);
  });
});

describe("toggleHiddenFilesCommand", () => {
  it("no-ops without a workspace", () => {
    toggleHiddenFilesCommand();
    expect(useLayout.getState().showHidden).toEqual({});
  });

  it("flips dotfile visibility for the workspace", () => {
    useWorkspace.setState({ current: WS, readOnly: false });
    toggleHiddenFilesCommand();
    expect(useLayout.getState().isShowHidden(WS)).toBe(true);
  });
});

describe("peekSidebarCommand", () => {
  it("no-ops without a workspace", () => {
    peekSidebarCommand();
    expect(useSidebarPeek.getState().open).toBe(false);
  });

  it("no-ops when the sidebar is already visible", () => {
    useWorkspace.setState({ current: WS, readOnly: false });
    // not hidden → visible → peek is redundant
    peekSidebarCommand();
    expect(useSidebarPeek.getState().open).toBe(false);
  });

  it("opens the peek overlay when the sidebar is hidden", () => {
    useWorkspace.setState({ current: WS, readOnly: false });
    useLayout.getState().setSidebarHidden(WS, true);
    peekSidebarCommand();
    expect(useSidebarPeek.getState().open).toBe(true);
  });

  it("remembers the focused element for focus restoration", () => {
    useWorkspace.setState({ current: WS, readOnly: false });
    useLayout.getState().setSidebarHidden(WS, true);
    const btn = document.createElement("button");
    document.body.appendChild(btn);
    btn.focus();
    peekSidebarCommand();
    expect(useSidebarPeek.getState().restoreFocusEl).toBe(btn);
    btn.remove();
  });

  it("stores null when the active element is not an HTMLElement", () => {
    useWorkspace.setState({ current: WS, readOnly: false });
    useLayout.getState().setSidebarHidden(WS, true);
    const original = Object.getOwnPropertyDescriptor(Document.prototype, "activeElement");
    Object.defineProperty(document, "activeElement", { configurable: true, get: () => null });
    try {
      peekSidebarCommand();
      expect(useSidebarPeek.getState().restoreFocusEl).toBeNull();
    } finally {
      if (original) Object.defineProperty(Document.prototype, "activeElement", original);
    }
  });
});
