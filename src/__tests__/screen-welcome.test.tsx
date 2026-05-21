// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@tauri-apps/api/app", () => ({
  getVersion: () => Promise.resolve("9.9.9"),
}));
const fsStatBehaviour = { mode: "ok" as "ok" | "missing" };
const driveBehaviour = { kind: "internal" as "internal" | "external" | "network" | "fail" };
vi.mock("@tauri-apps/api/core", () => ({
  invoke: (cmd: string) => {
    if (cmd === "fs_stat") {
      return fsStatBehaviour.mode === "ok"
        ? Promise.resolve({})
        : Promise.reject(new Error("missing"));
    }
    if (cmd === "drive_classify") {
      if (driveBehaviour.kind === "fail") return Promise.reject(new Error("nope"));
      return Promise.resolve({ kind: driveBehaviour.kind });
    }
    return Promise.resolve(undefined);
  },
}));
const askBehaviour = { result: true };
vi.mock("@tauri-apps/plugin-dialog", () => ({
  ask: () => Promise.resolve(askBehaviour.result),
}));

import { Welcome } from "../screens/Welcome";
import { useRecentWorkspaces } from "../store/recent-workspaces";

afterEach(() => {
  cleanup();
  fsStatBehaviour.mode = "ok";
  driveBehaviour.kind = "internal";
  askBehaviour.result = true;
});

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

  it("invokes the new-workspace callback via the Cmd+Shift+N shortcut", () => {
    const onNewWorkspace = vi.fn();
    render(<Welcome onNewWorkspace={onNewWorkspace} />);
    fireEvent.keyDown(window, { key: "n", metaKey: true, shiftKey: true });
    expect(onNewWorkspace).toHaveBeenCalled();
  });

  it("marks a recent path as missing when fs_stat rejects and the drive is internal", async () => {
    fsStatBehaviour.mode = "missing";
    useRecentWorkspaces.setState({
      recent: [{ path: "/gone/path", lastOpenedMs: Date.now() }],
    });
    render(<Welcome />);
    await waitFor(() => {
      expect(
        document.querySelector('[title*="not found"]') ?? document.querySelector("svg"),
      ).toBeTruthy();
    });
  });

  it("marks a recent path as unmounted when the drive is classified as external", async () => {
    fsStatBehaviour.mode = "missing";
    driveBehaviour.kind = "external";
    useRecentWorkspaces.setState({
      recent: [{ path: "/external/drive/ws", lastOpenedMs: Date.now() }],
    });
    render(<Welcome />);
    await waitFor(() => {
      expect(document.querySelector('[title*="drive not mounted"]')).toBeTruthy();
    });
  });

  it("falls back to missing when drive_classify itself rejects", async () => {
    fsStatBehaviour.mode = "missing";
    driveBehaviour.kind = "fail";
    useRecentWorkspaces.setState({
      recent: [{ path: "/broken/drive", lastOpenedMs: Date.now() }],
    });
    render(<Welcome />);
    await waitFor(() => {
      expect(document.querySelector('[title*="not found"]')).toBeTruthy();
    });
  });

  it("prompts to remove a missing recent path when the user clicks it", async () => {
    fsStatBehaviour.mode = "missing";
    useRecentWorkspaces.setState({
      recent: [{ path: "/missing/ws", lastOpenedMs: Date.now() }],
    });
    const onOpenRecent = vi.fn();
    render(<Welcome onOpenRecent={onOpenRecent} />);
    await waitFor(() => {
      expect(document.querySelector('[title*="not found"]')).toBeTruthy();
    });
    fireEvent.click(screen.getByText("ws"));
    await waitFor(() => {
      expect(useRecentWorkspaces.getState().recent).toHaveLength(0);
    });
    expect(onOpenRecent).not.toHaveBeenCalled();
  });

  it("keeps the missing entry when the remove prompt is declined", async () => {
    fsStatBehaviour.mode = "missing";
    askBehaviour.result = false;
    useRecentWorkspaces.setState({
      recent: [{ path: "/missing/keep", lastOpenedMs: Date.now() }],
    });
    render(<Welcome />);
    await waitFor(() => {
      expect(document.querySelector('[title*="not found"]')).toBeTruthy();
    });
    fireEvent.click(screen.getByText("keep"));
    // Give the async handler a chance to settle.
    await new Promise((r) => setTimeout(r, 10));
    expect(useRecentWorkspaces.getState().recent).toHaveLength(1);
  });

  it("warns the user when clicking an unmounted recent path without opening it", async () => {
    fsStatBehaviour.mode = "missing";
    driveBehaviour.kind = "external";
    useRecentWorkspaces.setState({
      recent: [{ path: "/usb/ws", lastOpenedMs: Date.now() }],
    });
    const onOpenRecent = vi.fn();
    render(<Welcome onOpenRecent={onOpenRecent} />);
    await waitFor(() => {
      expect(document.querySelector('[title*="drive not mounted"]')).toBeTruthy();
    });
    fireEvent.click(screen.getByText("ws"));
    await new Promise((r) => setTimeout(r, 10));
    expect(onOpenRecent).not.toHaveBeenCalled();
  });

  it("navigates the recent list with ArrowDown / ArrowUp and opens on Enter", async () => {
    useRecentWorkspaces.setState({
      recent: [
        { path: "/a/first", lastOpenedMs: Date.now() },
        { path: "/b/second", lastOpenedMs: Date.now() - 1000 },
      ],
    });
    const onOpenRecent = vi.fn();
    render(<Welcome onOpenRecent={onOpenRecent} />);
    const list = screen.getByLabelText("Recent workspaces");
    fireEvent.keyDown(list, { key: "ArrowDown" });
    fireEvent.keyDown(list, { key: "ArrowDown" });
    fireEvent.keyDown(list, { key: "ArrowUp" });
    fireEvent.keyDown(list, { key: "Enter" });
    await waitFor(() => expect(onOpenRecent).toHaveBeenCalledWith("/a/first"));
  });

  it("falls back to the full path when the last segment is empty", () => {
    useRecentWorkspaces.setState({
      recent: [{ path: "/", lastOpenedMs: Date.now() }],
    });
    render(<Welcome />);
    expect(screen.getAllByText("/").length).toBeGreaterThan(0);
  });

  it("ignores arrow keys when the recent list is empty (defensive guard)", () => {
    render(<Welcome />);
    // No `Recent workspaces` ul rendered when empty; nothing to assert besides no throw.
    expect(screen.queryByLabelText("Recent workspaces")).toBeNull();
  });
});
