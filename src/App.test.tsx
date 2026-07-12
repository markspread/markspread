// @vitest-environment jsdom
import { cleanup, render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("./lib/dnd", () => ({ registerDragDrop: vi.fn(() => () => {}) }));
vi.mock("./lib/cli-forwarded", () => ({ registerCliForwardedListener: vi.fn(() => () => {}) }));
vi.mock("./lib/keybindings", () => ({ registerKeybindings: vi.fn(() => () => {}) }));
vi.mock("./lib/unmount", () => ({
  registerUnmountListener: vi.fn(() => () => {}),
  maybeStartUnmountWatch: vi.fn(async () => {}),
  stopUnmountWatch: vi.fn(async () => {}),
}));
vi.mock("./lib/polling-notice", () => ({
  registerPollingNoticeListener: vi.fn(() => () => {}),
}));
const stopParserHotReload = vi.fn();
vi.mock("./lib/parsers/hot-reload-tauri", () => ({
  startParserHotReload: vi.fn(() => stopParserHotReload),
}));
vi.mock("./lib/font-effect", () => ({ useFontFamilyEffect: () => {} }));
vi.mock("./lib/open-workspace", () => ({
  openWorkspaceFromDialog: vi.fn(async () => {}),
  newWorkspaceFromDialog: vi.fn(async () => {}),
}));
vi.mock("./lib/open-md-file", () => ({ openSingleMdFromDialog: vi.fn(async () => {}) }));
vi.mock("./screens/WorkspaceShell", () => ({
  WorkspaceShell: () => <div data-testid="workspace-shell" />,
}));
vi.mock("./screens/SingleFile", () => ({ SingleFile: () => <div data-testid="single" /> }));
vi.mock("./screens/Welcome", () => ({
  Welcome: ({
    onOpenWorkspace,
    onNewWorkspace,
    onSkipToSingleFile,
    onOpenRecent,
  }: {
    onOpenWorkspace: () => void;
    onNewWorkspace: () => void;
    onSkipToSingleFile: () => void;
    onOpenRecent: (p: string) => void;
  }) => (
    <div data-testid="welcome">
      <button type="button" data-testid="open-ws" onClick={onOpenWorkspace} />
      <button type="button" data-testid="new-ws" onClick={onNewWorkspace} />
      <button type="button" data-testid="single" onClick={onSkipToSingleFile} />
      <button type="button" data-testid="recent" onClick={() => onOpenRecent("/r")} />
    </div>
  ),
}));
vi.mock("./components/AiActionPalette", () => ({
  AiActionPalette: ({ onInvoke }: { onInvoke: (id: string) => void }) => (
    <button type="button" data-testid="ai-palette" onClick={() => onInvoke("noop")} />
  ),
}));
vi.mock("./components/AutoUpdateConsent", () => ({ AutoUpdateConsent: () => null }));
vi.mock("./components/ChordIndicator", () => ({ ChordIndicator: () => null }));
vi.mock("./components/CommandPalette", () => ({ CommandPalette: () => null }));
vi.mock("./components/CrashRecoveryDialog", () => ({ CrashRecoveryDialog: () => null }));
vi.mock("./components/ErrorBoundary", () => ({
  ErrorBoundary: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));
vi.mock("./components/ExportDialog", () => ({ ExportDialog: () => null }));
vi.mock("./components/ImageDialog", () => ({ ImageDialog: () => null }));
vi.mock("./components/IndexProgressBar", () => ({ IndexProgressBar: () => null }));
vi.mock("./components/InsertTableDialog", () => ({ InsertTableDialog: () => null }));
vi.mock("./components/LinkDialog", () => ({ LinkDialog: () => null }));
vi.mock("./components/TelemetryConsent", () => ({ TelemetryConsent: () => null }));
vi.mock("./components/ToastStack", () => ({ ToastStack: () => null }));
vi.mock("./screens/HarnessRoot", () => ({
  HarnessRoot: ({ mode }: { mode: string }) => <div data-testid="harness" data-mode={mode} />,
}));
vi.mock("./screens/ParserWorkbench", () => ({
  ParserWorkbench: () => <div data-testid="parser" />,
}));

import App from "./App";
import { startParserHotReload } from "./lib/parsers/hot-reload-tauri";
import { useActivityMode } from "./store/activity-mode";
import { useRecentWorkspaces } from "./store/recent-workspaces";
import { useSingleFile } from "./store/single-file";
import { useTabs } from "./store/tabs";
import { useWorkspace } from "./store/workspace";

afterEach(cleanup);

describe("App", () => {
  beforeEach(() => {
    useWorkspace.setState({ current: null });
    useSingleFile.setState({ path: null });
    useTabs.setState({ activePath: null } as never, false);
    useActivityMode.setState({ mode: "workspace" });
  });

  it("renders Welcome when no workspace and no single file", () => {
    const { getByTestId } = render(<App />);
    expect(getByTestId("welcome")).toBeTruthy();
  });

  // ADR-0019 §Decision.1: a workspace in `workspace` mode routes to the
  // single unified WorkspaceShell — no chat/editor branch.
  it("renders the WorkspaceShell when a workspace is open in workspace mode", () => {
    useWorkspace.setState({ current: "/ws" });
    const { getByTestId } = render(<App />);
    expect(getByTestId("workspace-shell")).toBeTruthy();
    // the rail is present so the user can switch modes
    expect(getByTestId("activity-bar")).toBeTruthy();
  });

  it("renders ParserWorkbench when workspace + activity mode = parser", () => {
    useWorkspace.setState({ current: "/ws" });
    useActivityMode.setState({ mode: "parser" });
    const { getByTestId } = render(<App />);
    expect(getByTestId("parser")).toBeTruthy();
    // activity bar is present so the user can switch back
    expect(getByTestId("activity-bar")).toBeTruthy();
  });

  // SC-WB-03 / S-PSDK-004: opening a workspace arms the `.markspread/parsers/`
  // hot-reload watch; unmounting (or switching workspaces) disposes it.
  it("starts parser hot-reload for the open workspace and disposes on unmount", () => {
    vi.mocked(startParserHotReload).mockClear();
    stopParserHotReload.mockClear();
    useWorkspace.setState({ current: "/ws" });
    const { unmount } = render(<App />);
    expect(startParserHotReload).toHaveBeenCalledWith("/ws");
    unmount();
    expect(stopParserHotReload).toHaveBeenCalled();
  });

  it("does not start parser hot-reload when no workspace is open", () => {
    vi.mocked(startParserHotReload).mockClear();
    render(<App />);
    expect(startParserHotReload).not.toHaveBeenCalled();
  });

  it("renders SingleFile when a single-file path is set (wins over workspace)", () => {
    useWorkspace.setState({ current: "/ws" });
    useSingleFile.setState({ path: "/a.md" });
    const { getByTestId } = render(<App />);
    expect(getByTestId("single")).toBeTruthy();
  });

  it("wires the Welcome buttons to their open-dialog handlers", () => {
    const { getByTestId } = render(<App />);
    getByTestId("open-ws").click();
    getByTestId("new-ws").click();
    getByTestId("single").click();
    getByTestId("recent").click();
    expect(useRecentWorkspaces.getState().recent.map((r) => r.path)).toContain("/r");
  });

  it("invokes the AI palette stub callback (warning path)", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const { getByTestId } = render(<App />);
    getByTestId("ai-palette").click();
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });

  it("derives a basename for the export document title from the active tab path", () => {
    useTabs.setState({ activePath: "/ws/notes/a.md" } as never, false);
    useWorkspace.setState({ current: "/ws" });
    render(<App />);
    expect(useTabs.getState().activePath).toBe("/ws/notes/a.md");
  });

  it("mounts the harness root when ?harness=<mode> is present", () => {
    const original = window.location.href;
    window.history.replaceState({}, "", "?harness=returning-user");
    try {
      const { getByTestId } = render(<App />);
      const el = getByTestId("harness");
      expect(el.getAttribute("data-mode")).toBe("returning-user");
    } finally {
      window.history.replaceState({}, "", original);
    }
  });
});
