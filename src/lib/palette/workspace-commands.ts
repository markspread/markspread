// MAR-1015 palette wiring for workspace-shell commands.
//
// Surfaces the chords from `useWorkspaceShellShortcuts` in the command
// palette so a user who hasn't memorised Mod+\ / Mod+Alt+Arrow still
// discovers (and triggers) the same actions. Shell-scope filtering is
// honoured at trigger time — when the chat shell is active the items
// stay listed (so they're discoverable) but the run handler short-
// circuits.

import { focusSplitInDirection } from "../../hooks/useWorkspaceShellShortcuts";
import { findTab, useWorkspaceLayout } from "../../store/workspace-layout";
import { formatBinding, normaliseBinding } from "../keybindings";
import { type PaletteItem, registerPaletteItem } from "./registry";

/** Test seam — allows the unit suite to provide stub stores. */
export interface WorkspaceCommandsDeps {
  getLayout: () => { activeTabId: string; root: { type: string } } | null;
  addWorkspaceTab: (workspacePath: string) => unknown;
  closeWorkspaceTab: (tabId: string) => boolean;
  splitVertical: () => unknown;
  splitHorizontal: () => unknown;
  setActiveTab: (tabId: string) => void;
  /** Active tab's workspace path, for tab-duplication semantics. */
  getActiveWorkspacePath: () => string | null;
  /** Tabs in the active ws-tabs node, in order. */
  getActiveTabsList: () => { id: string }[];
  focusSplitInDirection: (dir: "up" | "down" | "left" | "right") => boolean;
}

interface WorkspaceCommandSpec {
  id: string;
  label: string;
  description: string;
  binding: string;
  run: (deps: WorkspaceCommandsDeps) => void;
}

const SPECS: WorkspaceCommandSpec[] = [
  {
    id: "workspace.new_tab",
    label: "Workspace: New Tab",
    description: "Open a new workspace tab in the active split.",
    binding: "Mod+T",
    run: (d) => {
      const path = d.getActiveWorkspacePath();
      if (path) d.addWorkspaceTab(path);
    },
  },
  {
    id: "workspace.close_tab",
    label: "Workspace: Close Tab",
    description: "Close the active workspace tab.",
    binding: "Mod+W",
    run: (d) => {
      const layout = d.getLayout();
      if (layout) d.closeWorkspaceTab(layout.activeTabId);
    },
  },
  {
    id: "workspace.split_vertical",
    label: "Workspace: Split Vertical",
    description: "Split the active tab side-by-side.",
    binding: "Mod+\\",
    run: (d) => {
      d.splitVertical();
    },
  },
  {
    id: "workspace.split_horizontal",
    label: "Workspace: Split Horizontal",
    description: "Split the active tab top/bottom.",
    binding: "Mod+Shift+\\",
    run: (d) => {
      d.splitHorizontal();
    },
  },
  {
    id: "workspace.focus_split_up",
    label: "Workspace: Focus Split Up",
    description: "Move focus to the split above.",
    binding: "Mod+Alt+ArrowUp",
    run: (d) => {
      d.focusSplitInDirection("up");
    },
  },
  {
    id: "workspace.focus_split_down",
    label: "Workspace: Focus Split Down",
    description: "Move focus to the split below.",
    binding: "Mod+Alt+ArrowDown",
    run: (d) => {
      d.focusSplitInDirection("down");
    },
  },
  {
    id: "workspace.focus_split_left",
    label: "Workspace: Focus Split Left",
    description: "Move focus to the split on the left.",
    binding: "Mod+Alt+ArrowLeft",
    run: (d) => {
      d.focusSplitInDirection("left");
    },
  },
  {
    id: "workspace.focus_split_right",
    label: "Workspace: Focus Split Right",
    description: "Move focus to the split on the right.",
    binding: "Mod+Alt+ArrowRight",
    run: (d) => {
      d.focusSplitInDirection("right");
    },
  },
  ...Array.from({ length: 9 }, (_, i): WorkspaceCommandSpec => {
    const n = i + 1;
    return {
      id: `workspace.tab_${n}`,
      label: `Workspace: Switch to Tab ${n}`,
      description: `Activate the ${n}${ordinal(n)} workspace tab in the current split.`,
      binding: `Mod+${n}`,
      run: (d) => {
        const tabs = d.getActiveTabsList();
        const tab = tabs[i];
        if (tab) d.setActiveTab(tab.id);
      },
    };
  }),
];

function ordinal(n: number): string {
  /* v8 ignore next 3 -- n is always 1..9 from Array.from above, so 11..13 special case is unreachable; defensive */
  if (n >= 11 && n <= 13) return "th";
  switch (n % 10) {
    case 1:
      return "st";
    case 2:
      return "nd";
    case 3:
      return "rd";
    default:
      return "th";
  }
}

function makeItem(spec: WorkspaceCommandSpec, deps: WorkspaceCommandsDeps): PaletteItem {
  return {
    id: spec.id,
    category: "command",
    label: spec.label,
    description: spec.description,
    shortcut: formatBinding(normaliseBinding(spec.binding)),
    searchKey: `${spec.label} ${spec.description}`.toLowerCase(),
    // ADR-0019: single Workspace shell — no chat/editor scope gate. The
    // command runs whenever the workspace surface is mounted.
    run: () => spec.run(deps),
  };
}

/**
 * Register every workspace-shell command into the palette. Returns a
 * detacher; calling it removes the entries so locale-change refresh
 * works (matches `bootstrapSidebarPaletteItems` pattern).
 */
export function registerWorkspacePaletteCommands(deps: WorkspaceCommandsDeps): () => void {
  const detachers: (() => void)[] = [];
  for (const spec of SPECS) {
    detachers.push(registerPaletteItem(makeItem(spec, deps)));
  }
  return () => {
    while (detachers.length > 0) {
      const fn = detachers.pop();
      fn?.();
    }
  };
}

/** Test-only: surface SPECS metadata for parameterised tests. */
export const __workspaceCommandSpecs = SPECS;

/**
 * Wire SPECS into the live zustand stores. Splits the import-time
 * coupling so unit tests can use stub deps via
 * `registerWorkspacePaletteCommands` directly.
 */
/* v8 ignore start -- live-store bootstrap; the unit tests target registerWorkspacePaletteCommands with stubs, and the live wiring is exercised by integration / dom suites */
export function bootstrapWorkspacePaletteCommands(): () => void {
  return registerWorkspacePaletteCommands({
    getLayout: () => {
      const layout = useWorkspaceLayout.getState().layout;
      if (!layout) return null;
      return { activeTabId: layout.activeTabId, root: { type: layout.root.type } };
    },
    addWorkspaceTab: (path: string) => useWorkspaceLayout.getState().addWorkspaceTab(path),
    closeWorkspaceTab: (id: string) => useWorkspaceLayout.getState().closeWorkspaceTab(id),
    splitVertical: () => useWorkspaceLayout.getState().splitVertical(),
    splitHorizontal: () => useWorkspaceLayout.getState().splitHorizontal(),
    setActiveTab: (id: string) => useWorkspaceLayout.getState().setActiveTab(id),
    getActiveWorkspacePath: () => {
      const layout = useWorkspaceLayout.getState().layout;
      if (!layout) return null;
      const located = findTab(layout.root, layout.activeTabId);
      return located?.tab.workspacePath ?? null;
    },
    getActiveTabsList: () => {
      const layout = useWorkspaceLayout.getState().layout;
      if (!layout) return [];
      const located = findTab(layout.root, layout.activeTabId);
      if (!located) return [];
      return located.node.tabs.map((t) => ({ id: t.id }));
    },
    focusSplitInDirection,
  });
}
/* v8 ignore stop */
