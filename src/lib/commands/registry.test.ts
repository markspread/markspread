// S-TST: command registry — descriptor invariants and runCommand dispatch.

import { beforeEach, describe, expect, it, vi } from "vitest";

// Stub every wrapped command module so registry tests exercise the
// registry itself without booting stores / IPC / dynamic imports.
const {
  closeWorkspaceCommand,
  splitRightCommand,
  splitDownCommand,
  focusPaneCommand,
  closeActiveTabCommand,
  moveEditorToNextGroupCommand,
  exportKeybindingsCommand,
  importKeybindingsCommand,
  locateWorkspaceCommand,
  newFileCommand,
  newFolderCommand,
  newWindowCommand,
  toggleSidebarCommand,
  showSidebarCommand,
  hideSidebarCommand,
  peekSidebarCommand,
  toggleHiddenFilesCommand,
  switchWorkspaceCommand,
  openPalette,
  showExport,
} = vi.hoisted(() => ({
  closeWorkspaceCommand: vi.fn(),
  splitRightCommand: vi.fn(),
  splitDownCommand: vi.fn(),
  focusPaneCommand: vi.fn(),
  closeActiveTabCommand: vi.fn(),
  moveEditorToNextGroupCommand: vi.fn(),
  exportKeybindingsCommand: vi.fn(),
  importKeybindingsCommand: vi.fn(),
  locateWorkspaceCommand: vi.fn(),
  newFileCommand: vi.fn(),
  newFolderCommand: vi.fn(),
  newWindowCommand: vi.fn(),
  toggleSidebarCommand: vi.fn(),
  showSidebarCommand: vi.fn(),
  hideSidebarCommand: vi.fn(),
  peekSidebarCommand: vi.fn(),
  toggleHiddenFilesCommand: vi.fn(),
  switchWorkspaceCommand: vi.fn(),
  openPalette: vi.fn(),
  showExport: vi.fn(),
}));

vi.mock("./close-workspace", () => ({ closeWorkspaceCommand }));
vi.mock("./editor-layout", () => ({
  closeActiveTabCommand,
  focusPaneCommand,
  moveEditorToNextGroupCommand,
  splitDownCommand,
  splitRightCommand,
}));
vi.mock("./keybindings-io", () => ({ exportKeybindingsCommand, importKeybindingsCommand }));
vi.mock("./locate-workspace", () => ({ locateWorkspaceCommand }));
vi.mock("./new-file", () => ({ newFileCommand, newFolderCommand }));
vi.mock("./new-window", () => ({ newWindowCommand }));
vi.mock("./sidebar", () => ({
  hideSidebarCommand,
  peekSidebarCommand,
  showSidebarCommand,
  toggleHiddenFilesCommand,
  toggleSidebarCommand,
}));
vi.mock("./switch-workspace", () => ({ switchWorkspaceCommand }));
vi.mock("../../store/ai-palette", () => ({
  useAiPalette: { getState: () => ({ openPalette }) },
}));
vi.mock("../../store/dialogs", () => ({
  useDialogs: { getState: () => ({ showExport }) },
}));

import { commands, runCommand } from "./registry";

beforeEach(() => {
  vi.clearAllMocks();
});

describe("commands registry", () => {
  it("has unique command ids", () => {
    const ids = commands.map((c) => c.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("gives every command a title, category and run function", () => {
    for (const c of commands) {
      expect(typeof c.id).toBe("string");
      expect(c.title.length).toBeGreaterThan(0);
      expect(c.category.length).toBeGreaterThan(0);
      expect(typeof c.run).toBe("function");
    }
  });

  it("registers the expected default bindings", () => {
    const byId = new Map(commands.map((c) => [c.id, c]));
    expect(byId.get("filetree.new_file")?.defaultBinding).toBe("Mod+N");
    expect(byId.get("view.toggle_sidebar")?.defaultBinding).toBe("Mod+B");
    expect(byId.get("tabs.close_active")?.defaultBinding).toBe("Mod+W");
    expect(byId.get("ai.palette.open")?.when).toBe("editorFocus");
  });
});

describe("runCommand", () => {
  it("is a no-op for an unknown id", () => {
    expect(() => runCommand("does.not.exist")).not.toThrow();
  });

  it("dispatches workspace.close", () => {
    runCommand("workspace.close");
    expect(closeWorkspaceCommand).toHaveBeenCalled();
  });

  it("dispatches sidebar commands", () => {
    runCommand("view.toggle_sidebar");
    runCommand("view.show_sidebar");
    runCommand("view.hide_sidebar");
    runCommand("view.peek_sidebar");
    runCommand("filetree.toggle_hidden");
    expect(toggleSidebarCommand).toHaveBeenCalled();
    expect(showSidebarCommand).toHaveBeenCalled();
    expect(hideSidebarCommand).toHaveBeenCalled();
    expect(peekSidebarCommand).toHaveBeenCalled();
    expect(toggleHiddenFilesCommand).toHaveBeenCalled();
  });

  it("dispatches file commands", () => {
    runCommand("filetree.new_file");
    runCommand("filetree.new_folder");
    runCommand("window.new");
    expect(newFileCommand).toHaveBeenCalled();
    expect(newFolderCommand).toHaveBeenCalled();
    expect(newWindowCommand).toHaveBeenCalled();
  });

  it("dispatches editor-layout commands with the right pane index", () => {
    runCommand("view.split_right");
    runCommand("view.split_down");
    runCommand("view.focus_pane_1");
    runCommand("view.focus_pane_2");
    runCommand("view.focus_pane_3");
    runCommand("tabs.close_active");
    runCommand("view.move_editor_to_next_group");
    expect(splitRightCommand).toHaveBeenCalled();
    expect(splitDownCommand).toHaveBeenCalled();
    expect(focusPaneCommand).toHaveBeenCalledWith(1);
    expect(focusPaneCommand).toHaveBeenCalledWith(2);
    expect(focusPaneCommand).toHaveBeenCalledWith(3);
    expect(closeActiveTabCommand).toHaveBeenCalled();
    expect(moveEditorToNextGroupCommand).toHaveBeenCalled();
  });

  it("forwards the arg to locate-workspace only when non-empty", () => {
    runCommand("workspace.locate", "/some/path");
    expect(locateWorkspaceCommand).toHaveBeenCalledWith("/some/path");
    locateWorkspaceCommand.mockClear();
    runCommand("workspace.locate");
    expect(locateWorkspaceCommand).not.toHaveBeenCalled();
  });

  it("forwards the arg to switch-workspace only when non-empty", () => {
    runCommand("workspace.switch", "/target");
    expect(switchWorkspaceCommand).toHaveBeenCalledWith("/target");
    switchWorkspaceCommand.mockClear();
    runCommand("workspace.switch", "");
    expect(switchWorkspaceCommand).not.toHaveBeenCalled();
  });

  it("forwards the mode arg to keybindings import", () => {
    runCommand("keybindings.export");
    runCommand("keybindings.import", "replace");
    expect(exportKeybindingsCommand).toHaveBeenCalled();
    expect(importKeybindingsCommand).toHaveBeenCalledWith("replace");
  });

  it("opens the AI palette and the export dialog via dynamic import", async () => {
    const aiCmd = commands.find((c) => c.id === "ai.palette.open");
    const exportCmd = commands.find((c) => c.id === "export.document");
    if (!aiCmd || !exportCmd) throw new Error("expected commands");
    await aiCmd.run();
    await exportCmd.run();
    expect(openPalette).toHaveBeenCalled();
    expect(showExport).toHaveBeenCalled();
  });
});
