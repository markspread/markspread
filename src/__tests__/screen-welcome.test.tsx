// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@tauri-apps/api/app", () => ({
  getVersion: () => Promise.resolve("9.9.9"),
}));
vi.mock("@tauri-apps/api/core", () => ({
  invoke: (cmd: string) => {
    if (cmd === "fs_stat") return Promise.resolve({});
    return Promise.resolve({ kind: "internal" });
  },
}));
vi.mock("@tauri-apps/plugin-dialog", () => ({
  ask: () => Promise.resolve(true),
}));

import { Welcome } from "../screens/Welcome";
import { useRecentWorkspaces } from "../store/recent-workspaces";

afterEach(cleanup);

describe("screens/Welcome", () => {
  beforeEach(() => {
    useRecentWorkspaces.setState({ recent: [] });
  });

  it("renders the brand panel and the version", async () => {
    render(<Welcome />);
    expect(screen.getByText("Markspread")).toBeTruthy();
    await waitFor(() => expect(screen.getByText("v9.9.9")).toBeTruthy());
  });

  it("shows the empty recent-workspaces state", () => {
    render(<Welcome />);
    expect(screen.getByText("No recently opened workspaces")).toBeTruthy();
  });

  it("invokes the open / new / single-file callbacks", () => {
    const onOpenWorkspace = vi.fn();
    const onNewWorkspace = vi.fn();
    const onSkipToSingleFile = vi.fn();
    render(
      <Welcome
        onOpenWorkspace={onOpenWorkspace}
        onNewWorkspace={onNewWorkspace}
        onSkipToSingleFile={onSkipToSingleFile}
      />,
    );
    fireEvent.click(screen.getByText("Open workspace"));
    fireEvent.click(screen.getByText("Create new workspace"));
    fireEvent.click(screen.getByText("Open single markdown file"));
    expect(onOpenWorkspace).toHaveBeenCalled();
    expect(onNewWorkspace).toHaveBeenCalled();
    expect(onSkipToSingleFile).toHaveBeenCalled();
  });

  it("responds to keyboard shortcuts", () => {
    const onOpenWorkspace = vi.fn();
    const onSkipToSingleFile = vi.fn();
    render(<Welcome onOpenWorkspace={onOpenWorkspace} onSkipToSingleFile={onSkipToSingleFile} />);
    fireEvent.keyDown(window, { key: "o", metaKey: true });
    fireEvent.keyDown(window, { key: "Escape" });
    expect(onOpenWorkspace).toHaveBeenCalled();
    expect(onSkipToSingleFile).toHaveBeenCalled();
  });

  it("lists recent workspaces and opens one", async () => {
    useRecentWorkspaces.setState({
      recent: [{ path: "/projects/alpha", lastOpenedMs: Date.now() }],
    });
    const onOpenRecent = vi.fn();
    render(<Welcome onOpenRecent={onOpenRecent} />);
    expect(screen.getByText("alpha")).toBeTruthy();
    await waitFor(() => {
      fireEvent.click(screen.getByText("alpha"));
    });
    await waitFor(() => expect(onOpenRecent).toHaveBeenCalledWith("/projects/alpha"));
  });

  it("removes a recent workspace via the remove control", () => {
    useRecentWorkspaces.setState({
      recent: [{ path: "/projects/beta", lastOpenedMs: Date.now() }],
    });
    render(<Welcome />);
    fireEvent.click(screen.getByLabelText("Remove from recent"));
    expect(useRecentWorkspaces.getState().recent).toHaveLength(0);
  });
});
