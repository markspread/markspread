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
});
