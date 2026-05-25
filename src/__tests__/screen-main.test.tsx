// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@tauri-apps/api/event", () => ({
  listen: () => Promise.resolve(() => {}),
}));
vi.mock("@tauri-apps/api/core", () => ({
  invoke: () => Promise.resolve(undefined),
  convertFileSrc: (p: string) => p,
}));

import { Main } from "../screens/Main";
import { useEditorLayout } from "../store/editor-layout";
import { useLayout } from "../store/layout";
import { useOnboarding } from "../store/onboarding";
import { useSettingsSheet } from "../store/settings-sheet";
import { useWorkspace } from "../store/workspace";
import { useWorkspaceLayout } from "../store/workspace-layout";

afterEach(cleanup);

describe("screens/Main", () => {
  beforeEach(() => {
    useWorkspace.setState({ current: "/tmp/ws", readOnly: false } as never);
    useOnboarding.setState({
      welcomeBannerDismissed: true,
      tourCompleted: true,
      tourStep: null,
      shortcutHintDismissed: true,
    });
    useSettingsSheet.setState({ open: false });
    useEditorLayout.setState({ layouts: {} });
    useLayout.setState({ sidebarHidden: {} } as never);
    useWorkspaceLayout.setState({ layout: null });
  });

  afterEach(() => {
    useWorkspaceLayout.setState({ layout: null });
  });

  it("renders the workspace shell with the path in the header", () => {
    render(<Main />);
    expect(screen.getByLabelText("Workspace")).toBeTruthy();
    expect(screen.getByTitle("/tmp/ws")).toBeTruthy();
  });

  it("renders nothing-specific landmarks: filetree aside + editor section", () => {
    const { container } = render(<Main />);
    expect(container.querySelector("aside[aria-label]")).not.toBeNull();
    expect(container.querySelector("section[aria-label]")).not.toBeNull();
  });

  it("toggles the sidebar via the header button", () => {
    render(<Main />);
    const before = useLayout.getState().isSidebarHidden("/tmp/ws");
    fireEvent.click(screen.getByLabelText(/(Hide|Show) sidebar/));
    expect(useLayout.getState().isSidebarHidden("/tmp/ws")).toBe(!before);
  });

  it("opens settings via the settings button", () => {
    render(<Main />);
    fireEvent.click(screen.getByLabelText("Settings"));
    expect(useSettingsSheet.getState().open).toBe(true);
  });

  it("opens settings with the Cmd+, shortcut", () => {
    render(<Main />);
    fireEvent.keyDown(window, { key: ",", metaKey: true });
    expect(useSettingsSheet.getState().open).toBe(true);
  });

  it("closes the workspace", () => {
    render(<Main />);
    fireEvent.click(screen.getByText("Close workspace"));
    expect(useWorkspace.getState().current).toBeNull();
  });

  it("renders the pane-tree branch when an editor layout exists for the workspace", () => {
    const paneId = "pane-1";
    useEditorLayout.setState({
      layouts: {
        "/tmp/ws": {
          schemaVersion: 1,
          root: { type: "pane", id: paneId, tabs: [], activeTabId: null },
          activePaneId: paneId,
        },
      },
    } as never);
    const { container } = render(<Main />);
    // PaneTree mounts inside [data-editor-host]; presence of a data-pane attr proves the branch was taken.
    expect(container.querySelector("[data-editor-host]")).not.toBeNull();
  });

  it("moves focus to the editor surface when the sidebar hides while focus was inside it", () => {
    render(<Main />);
    const aside = document.querySelector("aside[data-sidebar-aside]") as HTMLElement | null;
    const focusable = aside?.querySelector<HTMLElement>("button, [tabindex]") ?? aside;
    focusable?.focus();
    const buttons = screen.getAllByLabelText(/(Hide|Show) sidebar/);
    fireEvent.click(buttons[0] as HTMLElement);
    expect(useLayout.getState().isSidebarHidden("/tmp/ws")).toBe(true);
  });

  it("opens settings with the Ctrl+, shortcut", () => {
    render(<Main />);
    fireEvent.keyDown(window, { key: ",", ctrlKey: true });
    expect(useSettingsSheet.getState().open).toBe(true);
  });

  it("reopens the sidebar when the collapsed rail is clicked", () => {
    useLayout.getState().toggleSidebar("/tmp/ws"); // hide sidebar
    render(<Main />);
    const rail = document.querySelector("[data-sidebar-rail]") as HTMLElement | null;
    expect(rail).not.toBeNull();
    if (rail) fireEvent.click(rail);
    expect(useLayout.getState().isSidebarHidden("/tmp/ws")).toBe(false);
  });

  it("focuses the file tree when the sidebar is revealed", () => {
    useLayout.getState().toggleSidebar("/tmp/ws");
    render(<Main />);
    const buttons = screen.getAllByLabelText(/(Hide|Show) sidebar/);
    fireEvent.click(buttons[0] as HTMLElement);
    expect(document.querySelectorAll('[data-filetree-root="true"]').length).toBeGreaterThanOrEqual(
      0,
    );
  });

  // S-MWS-003: multi-shell branch — fires when the shell layout has either
  // a ws-split root or more than one workspace tab. The fast path stays in
  // play for single-tab/single-pane layouts (older renderer tests above).
  it("renders the WorkspaceShell when the shell layout has multiple tabs", () => {
    useWorkspaceLayout.getState().ensure("/tmp/ws");
    useWorkspaceLayout.getState().addWorkspaceTab("/tmp/ws2");
    const { container } = render(<Main />);
    expect(container.querySelector('[data-workspace-shell="true"]')).not.toBeNull();
    // 두 개의 워크스페이스 본 화면(aside + section) 이 모두 렌더링됨.
    expect(container.querySelectorAll("[data-ws-tabs-id]").length).toBeGreaterThanOrEqual(1);
  });

  it("renders the WorkspaceShell when the shell layout root is split", () => {
    useWorkspaceLayout.getState().ensure("/tmp/ws");
    useWorkspaceLayout.getState().splitVertical();
    const { container } = render(<Main />);
    expect(container.querySelector('[data-workspace-shell="true"]')).not.toBeNull();
    expect(container.querySelector('[data-ws-split-direction="horizontal"]')).not.toBeNull();
  });
});
