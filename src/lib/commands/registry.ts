import {
  closeActiveTabCommand,
  focusPaneCommand,
  moveEditorToNextGroupCommand,
  splitDownCommand,
  splitRightCommand,
} from "./editor-layout";
import { exportKeybindingsCommand, importKeybindingsCommand } from "./keybindings-io";
import { closeWorkspaceCommand } from "./close-workspace";
import { locateWorkspaceCommand } from "./locate-workspace";
import { newFileCommand, newFolderCommand } from "./new-file";
import { newWindowCommand } from "./new-window";
import {
  hideSidebarCommand,
  peekSidebarCommand,
  showSidebarCommand,
  toggleHiddenFilesCommand,
  toggleSidebarCommand,
} from "./sidebar";
import { switchWorkspaceCommand } from "./switch-workspace";

export type WhenClause =
  | "always"
  | "editorFocus"
  | "treeFocus"
  | "paletteOpen"
  | "sheetOpen"
  | "spreadFocus";

export interface CommandDescriptor {
  id: string;
  title: string;
  category: string;
  run: (arg?: string) => void | Promise<void>;
  defaultBinding?: string;
  /**
   * Context in which this command's binding is active. The
   * dispatcher (S-KB-005) filters keybinding candidates by the
   * current context — e.g. Mod+B is "view.toggle_sidebar" outside
   * the editor and "md.bold" inside it. Defaults to "always".
   */
  when?: WhenClause;
}

/**
 * Static registry of palette commands. The Command Palette (CP unit) will
 * read from here; for now individual screens can also `commands.find` and
 * trigger directly. Keep IDs stable — settings/keybindings reference them.
 */
export const commands: CommandDescriptor[] = [
  {
    id: "workspace.close",
    title: "Close Workspace",
    category: "Workspace",
    run: async () => {
      await closeWorkspaceCommand();
    },
  },
  {
    id: "window.new",
    title: "New Window",
    category: "Window",
    // S-FT-006 reclaimed Mod+Shift+N for "New Folder"; Window.new is Command
    // Palette only until the KB unit lets users rebind.
    run: async () => {
      await newWindowCommand();
    },
  },
  {
    id: "filetree.new_file",
    title: "New File",
    category: "File",
    defaultBinding: "Mod+N",
    run: () => newFileCommand(),
  },
  {
    id: "filetree.new_folder",
    title: "New Folder",
    category: "File",
    defaultBinding: "Mod+Shift+N",
    run: () => newFolderCommand(),
  },
  {
    id: "view.toggle_sidebar",
    title: "Toggle Sidebar",
    category: "View",
    defaultBinding: "Mod+B",
    // ADR-0001: Mod+B is "always" for sidebar so it fires from welcome /
    // editor / palette / tree alike. md.bold registers as "editorFocus",
    // and the dispatcher's specific-wins-over-always rule routes Mod+B
    // to bold only while the editor is focused.
    run: () => toggleSidebarCommand(),
  },
  {
    id: "view.show_sidebar",
    title: "Show Sidebar",
    category: "View",
    run: () => showSidebarCommand(),
  },
  {
    id: "view.hide_sidebar",
    title: "Hide Sidebar",
    category: "View",
    run: () => hideSidebarCommand(),
  },
  {
    id: "view.peek_sidebar",
    title: "Peek Sidebar",
    category: "View",
    // S-SBP-009: Mod+Shift+E parity with VSCode's "Show Explorer".
    // Available from anywhere; falls through to a no-op when the
    // sidebar is already expanded (peek would be redundant).
    defaultBinding: "Mod+Shift+E",
    run: () => peekSidebarCommand(),
  },
  {
    id: "filetree.toggle_hidden",
    title: "Toggle Hidden Files",
    category: "View",
    run: () => toggleHiddenFilesCommand(),
  },
  {
    id: "workspace.locate",
    title: "Locate Workspace…",
    category: "Workspace",
    run: async (oldPath) => {
      if (typeof oldPath === "string" && oldPath.length > 0) {
        await locateWorkspaceCommand(oldPath);
      }
    },
  },
  {
    id: "keybindings.export",
    title: "Export Keybindings…",
    category: "Keybindings",
    run: () => exportKeybindingsCommand(),
  },
  {
    id: "keybindings.import",
    title: "Import Keybindings…",
    category: "Keybindings",
    run: (mode) => importKeybindingsCommand(mode),
  },
  {
    id: "view.split_right",
    title: "Split Pane Right",
    category: "View",
    defaultBinding: "Mod+\\",
    run: () => splitRightCommand(),
  },
  {
    id: "view.split_down",
    title: "Split Pane Down",
    category: "View",
    defaultBinding: "Mod+K Mod+\\",
    run: () => splitDownCommand(),
  },
  {
    id: "view.focus_pane_1",
    title: "Focus Pane 1",
    category: "View",
    defaultBinding: "Mod+1",
    run: () => focusPaneCommand(1),
  },
  {
    id: "view.focus_pane_2",
    title: "Focus Pane 2",
    category: "View",
    defaultBinding: "Mod+2",
    run: () => focusPaneCommand(2),
  },
  {
    id: "view.focus_pane_3",
    title: "Focus Pane 3",
    category: "View",
    defaultBinding: "Mod+3",
    run: () => focusPaneCommand(3),
  },
  {
    id: "tabs.close_active",
    title: "Close Active Tab",
    category: "File",
    defaultBinding: "Mod+W",
    run: () => closeActiveTabCommand(),
  },
  {
    id: "view.move_editor_to_next_group",
    title: "Move Editor to Next Group",
    category: "View",
    run: () => moveEditorToNextGroupCommand(),
  },
  {
    id: "workspace.switch",
    title: "Switch Workspace…",
    category: "Workspace",
    run: async (target) => {
      if (typeof target === "string" && target.length > 0) {
        await switchWorkspaceCommand(target);
      }
      // Without a target the CP unit will surface a Recent picker; for now
      // we no-op so the command is still registered.
    },
  },
  {
    id: "ai.palette.open",
    title: "AI Actions…",
    category: "AI",
    defaultBinding: "Mod+.",
    when: "editorFocus",
    run: async () => {
      const { useAiPalette } = await import("../../store/ai-palette");
      useAiPalette.getState().openPalette();
    },
  },
  {
    id: "export.document",
    // No default keybinding: Mod+Shift+E is owned by view.peek_sidebar
    // (S-SBP-009, VSCode "Show Explorer" parity). Export stays reachable
    // via the command palette and the Export dialog UI.
    title: "Export Document…",
    category: "File",
    run: async () => {
      const { useDialogs } = await import("../../store/dialogs");
      useDialogs.getState().showExport();
    },
  },
];

export function runCommand(id: string, arg?: string): void {
  const cmd = commands.find((c) => c.id === id);
  if (!cmd) return;
  void cmd.run(arg);
}
