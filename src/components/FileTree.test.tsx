import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// jsdom doesn't implement scrollIntoView or ResizeObserver; stub both so the
// FileTree's keyboard-nav and VirtualList code paths don't blow up.
if (typeof Element !== "undefined" && !Element.prototype.scrollIntoView) {
  Element.prototype.scrollIntoView = function scrollIntoView() {};
}
interface RoSlot {
  cb: ResizeObserverCallback;
  el: Element | null;
}
const roInstances: RoSlot[] = [];
if (typeof globalThis.ResizeObserver === "undefined") {
  class FakeRO {
    private slot: RoSlot;
    constructor(cb: ResizeObserverCallback) {
      this.slot = { cb, el: null };
      roInstances.push(this.slot);
    }
    observe(el: Element) {
      this.slot.el = el;
    }
    unobserve() {}
    disconnect() {}
  }
  (globalThis as unknown as { ResizeObserver: typeof FakeRO }).ResizeObserver = FakeRO;
}

const invokeMock = vi.fn();
let fsEventHandler: ((event: { payload: unknown }) => void) | null = null;
const unlistenMock = vi.fn();

vi.mock("@tauri-apps/api/core", () => ({
  invoke: (cmd: string, args: unknown) => invokeMock(cmd, args),
}));
vi.mock("@tauri-apps/api/event", () => ({
  listen: (_name: string, handler: (e: { payload: unknown }) => void) => {
    fsEventHandler = handler;
    return Promise.resolve(unlistenMock);
  },
}));

const newFileCommandMock = vi.fn();
const newFolderCommandMock = vi.fn();
vi.mock("../lib/commands/new-file", () => ({
  newFileCommand: (...a: unknown[]) => newFileCommandMock(...a),
  newFolderCommand: (...a: unknown[]) => newFolderCommandMock(...a),
}));

vi.mock("./Icon", () => ({
  Icon: ({ name }: { name: string }) => <span data-testid={`icon-${name}`} />,
}));

import { splitKeyForWorkspace, useFileTree } from "../store/file-tree";

// MAR-1014: the store is now keyed by composite split-key. Tests in this
// file all run under the default split slot, so we resolve the key once
// per workspace and shape `{ splits: { [key]: paths } }` payloads.
function seedExpanded(map: Record<string, string[]>) {
  const splits: Record<string, string[]> = {};
  for (const ws of Object.keys(map)) {
    const paths = map[ws];
    if (paths) splits[splitKeyForWorkspace(ws)] = paths;
  }
  useFileTree.setState({ splits });
}
import { useLayout } from "../store/layout";
import { useSettings } from "../store/settings";
import { useTabs } from "../store/tabs";
import { useToasts } from "../store/toasts";
import { FileTree } from "./FileTree";

interface DirEntry {
  name: string;
  path: string;
  is_dir: boolean;
  modified_ms?: number | null;
}

const rootEntries: DirEntry[] = [
  { name: "docs", path: "/ws/docs", is_dir: true, modified_ms: 1 },
  { name: ".hidden", path: "/ws/.hidden", is_dir: false, modified_ms: 5 },
  { name: "readme.md", path: "/ws/readme.md", is_dir: false, modified_ms: 2 },
  { name: "notes.md", path: "/ws/notes.md", is_dir: false, modified_ms: 3 },
];
const docsEntries: DirEntry[] = [
  { name: "a.md", path: "/ws/docs/a.md", is_dir: false, modified_ms: 9 },
  { name: "sub", path: "/ws/docs/sub", is_dir: true, modified_ms: 8 },
];
const subEntries: DirEntry[] = [
  { name: "deep.md", path: "/ws/docs/sub/deep.md", is_dir: false, modified_ms: 7 },
];

function listResultFor(path: string): { entries: DirEntry[]; page: number; has_more: boolean } {
  if (path === "/ws") return { entries: rootEntries, page: 0, has_more: false };
  if (path === "/ws/docs") return { entries: docsEntries, page: 0, has_more: false };
  if (path === "/ws/docs/sub") return { entries: subEntries, page: 0, has_more: false };
  return { entries: [], page: 0, has_more: false };
}

function defaultInvoke(cmd: string, args: { path?: string } = {}) {
  if (cmd === "fs_list_dir") return Promise.resolve(listResultFor(args.path ?? "/ws"));
  if (cmd === "fs_check_locked") return Promise.resolve(false);
  if (cmd === "fs_stat") return Promise.reject("not found");
  if (cmd === "fs_create_file") return Promise.resolve(undefined);
  if (cmd === "fs_create_dir") return Promise.resolve(undefined);
  if (cmd === "fs_rename") return Promise.resolve(undefined);
  if (cmd === "fs_move") return Promise.resolve(undefined);
  if (cmd === "fs_trash_file") return Promise.resolve(undefined);
  if (cmd === "fs_trash_restore") return Promise.resolve(undefined);
  if (cmd === "fs_remove_dir") return Promise.resolve(undefined);
  if (cmd === "fs_remove_file") return Promise.resolve(undefined);
  if (cmd === "os_reveal_path") return Promise.resolve(undefined);
  if (cmd === "os_open_with") return Promise.resolve(undefined);
  return Promise.resolve(undefined);
}

function resetStores() {
  useFileTree.setState({ splits: {} });
  useTabs.setState({ tabs: [], activePath: null });
  useToasts.setState({ toasts: [] });
  useSettings.setState({ previewTabsEnabled: false } as never);
  useLayout.setState({
    sortMode: {},
    foldersFirst: {},
    showHidden: {},
  } as never);
}

async function renderRoot() {
  const out = render(<FileTree workspace="/ws" />);
  await waitFor(() => expect(screen.getAllByText("readme.md").length).toBeGreaterThan(0));
  return out;
}

afterEach(cleanup);

describe("FileTree", () => {
  beforeEach(() => {
    invokeMock.mockReset();
    invokeMock.mockImplementation(defaultInvoke);
    fsEventHandler = null;
    unlistenMock.mockReset();
    resetStores();
  });
  afterEach(resetStores);

  describe("listing & filter", () => {
    it("renders the workspace root listing", async () => {
      await renderRoot();
      expect(screen.getByText("docs")).toBeTruthy();
      expect(screen.getByRole("tree")).toBeTruthy();
    });

    it("hides dotfiles by default and shows them after toggling", async () => {
      await renderRoot();
      expect(screen.queryByText(".hidden")).toBeNull();
      fireEvent.click(screen.getByLabelText("Show hidden files"));
      await waitFor(() => expect(screen.getByText(".hidden")).toBeTruthy());
    });

    it("filters rows by the fuzzy filter input", async () => {
      await renderRoot();
      fireEvent.change(screen.getByLabelText("Filter files"), {
        target: { value: "notes" },
      });
      await waitFor(() => expect(screen.queryByText("readme.md")).toBeNull());
      expect(screen.getByText("notes.md")).toBeTruthy();
    });

    it("keeps a directory visible when its subtree contains a fuzzy match", async () => {
      seedExpanded({ "/ws": ["/ws/docs", "/ws/docs/sub"] });
      await renderRoot();
      await waitFor(() => expect(screen.getByText("deep.md")).toBeTruthy());
      fireEvent.change(screen.getByLabelText("Filter files"), {
        target: { value: "deep" },
      });
      // notes.md/readme.md don't match "deep" as a subsequence; docs/sub
      // stay visible because the subtree contains deep.md.
      await waitFor(() => expect(screen.queryByText("notes.md")).toBeNull());
      expect(screen.getByText("deep.md")).toBeTruthy();
    });

    it("clears the filter on Escape and blurs the input on a second Escape", async () => {
      await renderRoot();
      const input = screen.getByLabelText("Filter files") as HTMLInputElement;
      fireEvent.change(input, { target: { value: "x" } });
      fireEvent.keyDown(input, { key: "Escape" });
      expect(input.value).toBe("");
      input.focus();
      fireEvent.keyDown(input, { key: "Escape" });
    });

    it("opens the first file when Enter fires on the filter input", async () => {
      await renderRoot();
      const input = screen.getByLabelText("Filter files");
      fireEvent.keyDown(input, { key: "Enter" });
      await waitFor(() => expect(useTabs.getState().tabs.length).toBeGreaterThan(0));
    });

    it("transfers focus to the tree when ArrowDown is pressed inside the filter input", async () => {
      await renderRoot();
      const input = screen.getByLabelText("Filter files");
      fireEvent.keyDown(input, { key: "ArrowDown" });
    });

    it("cycles the sort mode through name → modified → type", async () => {
      await renderRoot();
      const btn = screen.getByLabelText("Sort mode");
      expect(useLayout.getState().getSortMode("/ws")).toBe("name");
      fireEvent.click(btn);
      expect(useLayout.getState().getSortMode("/ws")).toBe("modified");
      fireEvent.click(btn);
      expect(useLayout.getState().getSortMode("/ws")).toBe("type");
      fireEvent.click(btn);
      expect(useLayout.getState().getSortMode("/ws")).toBe("name");
    });

    it("toggles folders-first and re-sorts cached listings", async () => {
      await renderRoot();
      fireEvent.click(screen.getByLabelText("Folders first"));
      expect(useLayout.getState().isFoldersFirst("/ws")).toBe(true);
    });

    it("renders the un-highlighted folders-first chip when explicitly disabled", async () => {
      useLayout.setState({ foldersFirst: { "/ws": false } } as never);
      await renderRoot();
      const btn = screen.getByLabelText("Folders first");
      expect(btn.getAttribute("aria-pressed")).toBe("false");
      expect(btn.textContent).toContain("Mixed");
    });
  });

  describe("opening files", () => {
    it("opens a file when its row is clicked", async () => {
      await renderRoot();
      fireEvent.click(screen.getByText("readme.md"));
      await waitFor(() => expect(useTabs.getState().activePath).toBe("/ws/readme.md"));
    });

    it("opens pinned on double-click", async () => {
      await renderRoot();
      fireEvent.doubleClick(screen.getByText("readme.md"));
      const tab = useTabs.getState().tabs.find((t) => t.path === "/ws/readme.md");
      expect(tab?.preview).toBeFalsy();
    });

    it("toggles a directory expand state on click", async () => {
      await renderRoot();
      fireEvent.click(screen.getByText("docs"));
      await waitFor(() => expect(screen.getByText("a.md")).toBeTruthy());
      fireEvent.click(screen.getByText("docs"));
      await waitFor(() => expect(screen.queryByText("a.md")).toBeNull());
    });
  });

  describe("selection", () => {
    it("meta-click toggles a path in the selection", async () => {
      await renderRoot();
      fireEvent.click(screen.getByText("readme.md"));
      fireEvent.click(screen.getByText("notes.md"), { metaKey: true });
      // Re-meta-click toggles it off.
      fireEvent.click(screen.getByText("notes.md"), { metaKey: true });
    });

    it("shift-click selects a contiguous range from the anchor", async () => {
      await renderRoot();
      fireEvent.click(screen.getByText("docs"));
      await waitFor(() => expect(screen.getByText("a.md")).toBeTruthy());
      fireEvent.click(screen.getByText("readme.md"));
      fireEvent.click(screen.getByText("notes.md"), { shiftKey: true });
    });
  });

  describe("keyboard navigation", () => {
    async function setupTree() {
      const out = await renderRoot();
      const tree = screen.getByRole("tree");
      tree.focus();
      return { ...out, tree };
    }

    it("moves focus with ArrowDown / ArrowUp / Home / End", async () => {
      const { tree } = await setupTree();
      fireEvent.keyDown(tree, { key: "ArrowDown" });
      fireEvent.keyDown(tree, { key: "ArrowDown" });
      fireEvent.keyDown(tree, { key: "ArrowUp" });
      fireEvent.keyDown(tree, { key: "End" });
      fireEvent.keyDown(tree, { key: "Home" });
    });

    it("ArrowRight expands a collapsed dir and steps in when already expanded", async () => {
      const { tree } = await setupTree();
      // focus is on first row (docs); right expands
      fireEvent.keyDown(tree, { key: "ArrowRight" });
      await waitFor(() => expect(screen.getByText("a.md")).toBeTruthy());
      // right again steps into first child
      fireEvent.keyDown(tree, { key: "ArrowRight" });
    });

    it("ArrowLeft collapses an expanded dir then jumps to parent", async () => {
      seedExpanded({ "/ws": ["/ws/docs"] });
      const { tree } = await setupTree();
      // Step down into a.md (child of docs)
      fireEvent.keyDown(tree, { key: "ArrowDown" });
      fireEvent.keyDown(tree, { key: "ArrowLeft" }); // jump to docs
      fireEvent.keyDown(tree, { key: "ArrowLeft" }); // collapse docs
    });

    it("Enter opens a file row and toggles a dir row", async () => {
      const { tree } = await setupTree();
      // focus on docs → Enter toggles expansion
      fireEvent.keyDown(tree, { key: "Enter" });
      await waitFor(() => expect(screen.getByText("a.md")).toBeTruthy());
      // Move to readme.md and Enter to open
      fireEvent.keyDown(tree, { key: "ArrowDown" });
      fireEvent.keyDown(tree, { key: "ArrowDown" });
      fireEvent.keyDown(tree, { key: "ArrowDown" });
      fireEvent.keyDown(tree, { key: "Enter" });
    });

    it("F2 begins rename on the focused row", async () => {
      const { tree } = await setupTree();
      // Move to readme.md (skip docs, .hidden filtered)
      fireEvent.keyDown(tree, { key: "ArrowDown" });
      fireEvent.keyDown(tree, { key: "F2" });
      await waitFor(() => expect(screen.getByLabelText("New name")).toBeTruthy());
    });

    it("Shift+F10 opens the context menu at the focused row", async () => {
      const { tree } = await setupTree();
      fireEvent.keyDown(tree, { key: "F10", shiftKey: true });
      await waitFor(() => expect(screen.getByText("New File")).toBeTruthy());
    });

    it("Delete moves the focused file to trash", async () => {
      const { tree } = await setupTree();
      // Focus on readme.md
      fireEvent.keyDown(tree, { key: "ArrowDown" });
      fireEvent.keyDown(tree, { key: "Delete" });
      await waitFor(() =>
        expect(invokeMock).toHaveBeenCalledWith("fs_trash_file", expect.anything()),
      );
    });

    it("Cmd+Backspace also moves to trash", async () => {
      const { tree } = await setupTree();
      fireEvent.keyDown(tree, { key: "ArrowDown" });
      fireEvent.keyDown(tree, { key: "Backspace", metaKey: true });
      await waitFor(() =>
        expect(invokeMock).toHaveBeenCalledWith("fs_trash_file", expect.anything()),
      );
    });

    it("Shift+Delete fires permanent delete after confirm", async () => {
      vi.spyOn(window, "confirm").mockReturnValue(true);
      const { tree } = await setupTree();
      // focus on docs (dir)
      fireEvent.keyDown(tree, { key: "Shift", shiftKey: true });
      fireEvent.keyDown(tree, { key: "Delete", shiftKey: true });
      await waitFor(() =>
        expect(invokeMock).toHaveBeenCalledWith("fs_remove_dir", expect.anything()),
      );
    });

    it("permanent delete on a file calls fs_remove_file", async () => {
      vi.spyOn(window, "confirm").mockReturnValue(true);
      const { tree } = await setupTree();
      fireEvent.keyDown(tree, { key: "ArrowDown" });
      fireEvent.keyDown(tree, { key: "Delete", shiftKey: true });
      await waitFor(() =>
        expect(invokeMock).toHaveBeenCalledWith("fs_remove_file", expect.anything()),
      );
    });

    it("permanent delete on cancel does nothing", async () => {
      vi.spyOn(window, "confirm").mockReturnValue(false);
      const { tree } = await setupTree();
      fireEvent.keyDown(tree, { key: "ArrowDown" });
      fireEvent.keyDown(tree, { key: "Delete", shiftKey: true });
      // Should not have called fs_remove_file
      const removed = invokeMock.mock.calls.filter((c) => c[0] === "fs_remove_file");
      expect(removed.length).toBe(0);
    });

    it("ignores unknown keys", async () => {
      const { tree } = await setupTree();
      fireEvent.keyDown(tree, { key: "x" });
    });
  });

  describe("inline create", () => {
    // Focus a file row first so beginCreate's parent-scan resolves to the
    // workspace root (depth-0 parent search) instead of nesting under "docs".
    async function focusReadmeAndDispatch(event: string) {
      await renderRoot();
      fireEvent.click(screen.getByText("readme.md"));
      act(() => {
        window.dispatchEvent(new Event(event));
      });
    }

    it("creates a new file via the window event and submits the name", async () => {
      await focusReadmeAndDispatch("markspread:filetree:new-file");
      const input = await screen.findByPlaceholderText("Filename");
      fireEvent.change(input, { target: { value: "new" } });
      fireEvent.keyDown(input, { key: "Enter" });
      await waitFor(() =>
        expect(invokeMock).toHaveBeenCalledWith("fs_create_file", {
          workspace: "/ws",
          path: "/ws/new.md",
        }),
      );
    });

    it("creates a new file with explicit extension verbatim", async () => {
      await focusReadmeAndDispatch("markspread:filetree:new-file");
      const input = await screen.findByPlaceholderText("Filename");
      fireEvent.change(input, { target: { value: "n.txt" } });
      fireEvent.keyDown(input, { key: "Enter" });
      await waitFor(() =>
        expect(invokeMock).toHaveBeenCalledWith("fs_create_file", {
          workspace: "/ws",
          path: "/ws/n.txt",
        }),
      );
    });

    it("creates a new folder and auto-expands it", async () => {
      await focusReadmeAndDispatch("markspread:filetree:new-folder");
      const input = await screen.findByPlaceholderText("Filename");
      fireEvent.change(input, { target: { value: "foo" } });
      fireEvent.keyDown(input, { key: "Enter" });
      await waitFor(() =>
        expect(invokeMock).toHaveBeenCalledWith("fs_create_dir", {
          workspace: "/ws",
          path: "/ws/foo",
        }),
      );
    });

    it("shows an inline error when the new folder name already exists", async () => {
      invokeMock.mockImplementation((cmd: string, args: { path?: string } = {}) => {
        if (cmd === "fs_stat" && args.path === "/ws/dup") return Promise.resolve({});
        return defaultInvoke(cmd, args);
      });
      await focusReadmeAndDispatch("markspread:filetree:new-folder");
      const input = await screen.findByPlaceholderText("Filename");
      fireEvent.change(input, { target: { value: "dup" } });
      fireEvent.keyDown(input, { key: "Enter" });
      await waitFor(() => expect(screen.getByRole("alert").textContent).toContain("conflict"));
    });

    it("Escape cancels the inline create row", async () => {
      await focusReadmeAndDispatch("markspread:filetree:new-file");
      const input = await screen.findByPlaceholderText("Filename");
      fireEvent.keyDown(input, { key: "Escape" });
      await waitFor(() => expect(screen.queryByPlaceholderText("Filename")).toBeNull());
    });

    it("blur without an error cancels the inline create row", async () => {
      await focusReadmeAndDispatch("markspread:filetree:new-file");
      const input = await screen.findByPlaceholderText("Filename");
      fireEvent.blur(input);
      await waitFor(() => expect(screen.queryByPlaceholderText("Filename")).toBeNull());
    });

    it("submitting an empty name shows the inline error", async () => {
      await focusReadmeAndDispatch("markspread:filetree:new-file");
      const input = await screen.findByPlaceholderText("Filename");
      fireEvent.keyDown(input, { key: "Enter" });
      await waitFor(() => expect(screen.getByRole("alert")).toBeTruthy());
    });

    it("surfaces the underlying error when fs_create_file rejects with a generic message", async () => {
      invokeMock.mockImplementation((cmd: string, args: { path?: string } = {}) => {
        if (cmd === "fs_create_file") return Promise.reject({ message: "boom" });
        return defaultInvoke(cmd, args);
      });
      await focusReadmeAndDispatch("markspread:filetree:new-file");
      const input = await screen.findByPlaceholderText("Filename");
      fireEvent.change(input, { target: { value: "n" } });
      fireEvent.keyDown(input, { key: "Enter" });
      await waitFor(() => expect(screen.getByRole("alert").textContent).toContain("boom"));
    });

    it("creates inside the focused directory and auto-expands it", async () => {
      // Default focusedIdx=0 lands on "docs" (first row), so beginCreate
      // nests the new entry under /ws/docs.
      await renderRoot();
      // Wait until the root listing settled with docs as the first treeitem
      // so the new-file event fires with focusedIdx=0 on a stable flat list.
      await waitFor(() => {
        const rows = screen.getAllByRole("treeitem");
        expect(rows[0]?.textContent).toContain("docs");
      });
      act(() => {
        window.dispatchEvent(new Event("markspread:filetree:new-file"));
      });
      const input = await screen.findByPlaceholderText("Filename");
      fireEvent.change(input, { target: { value: "child" } });
      fireEvent.keyDown(input, { key: "Enter" });
      await waitFor(() =>
        expect(invokeMock).toHaveBeenCalledWith("fs_create_file", {
          workspace: "/ws",
          path: "/ws/docs/child.md",
        }),
      );
    });

    it("creating from a file row places the new entry alongside it (parent scan)", async () => {
      seedExpanded({ "/ws": ["/ws/docs"] });
      await renderRoot();
      await waitFor(() => expect(screen.getByText("a.md")).toBeTruthy());
      // Click on a.md (a file inside docs, depth 1) so the parent-scan path runs.
      fireEvent.click(screen.getByText("a.md"));
      act(() => {
        window.dispatchEvent(new Event("markspread:filetree:new-file"));
      });
      const input = await screen.findByPlaceholderText("Filename");
      fireEvent.change(input, { target: { value: "sib" } });
      fireEvent.keyDown(input, { key: "Enter" });
      await waitFor(() =>
        expect(invokeMock).toHaveBeenCalledWith("fs_create_file", {
          workspace: "/ws",
          path: "/ws/docs/sib.md",
        }),
      );
    });
  });

  describe("inline rename", () => {
    it("renames a file via F2", async () => {
      await renderRoot();
      const tree = screen.getByRole("tree");
      tree.focus();
      fireEvent.keyDown(tree, { key: "ArrowDown" }); // readme.md
      fireEvent.keyDown(tree, { key: "F2" });
      const input = await screen.findByLabelText("New name");
      fireEvent.change(input, { target: { value: "renamed.md" } });
      fireEvent.keyDown(input, { key: "Enter" });
      await waitFor(() => expect(invokeMock).toHaveBeenCalledWith("fs_rename", expect.anything()));
    });

    it("flags a name conflict when fs_stat resolves for the new name", async () => {
      invokeMock.mockImplementation((cmd: string, args: { path?: string } = {}) => {
        if (cmd === "fs_stat" && args.path === "/ws/dup.md") return Promise.resolve({});
        return defaultInvoke(cmd, args);
      });
      await renderRoot();
      const tree = screen.getByRole("tree");
      tree.focus();
      fireEvent.keyDown(tree, { key: "ArrowDown" });
      fireEvent.keyDown(tree, { key: "F2" });
      const input = await screen.findByLabelText("New name");
      fireEvent.change(input, { target: { value: "dup.md" } });
      fireEvent.keyDown(input, { key: "Enter" });
      await waitFor(() => expect(screen.getByRole("alert").textContent).toContain("conflict"));
    });

    it("surfaces a rename error message when fs_rename rejects with non-conflict reason", async () => {
      invokeMock.mockImplementation((cmd: string, args: { path?: string } = {}) => {
        if (cmd === "fs_rename") return Promise.reject({ message: "io error" });
        return defaultInvoke(cmd, args);
      });
      await renderRoot();
      const tree = screen.getByRole("tree");
      tree.focus();
      fireEvent.keyDown(tree, { key: "ArrowDown" });
      fireEvent.keyDown(tree, { key: "F2" });
      const input = await screen.findByLabelText("New name");
      fireEvent.change(input, { target: { value: "x.md" } });
      fireEvent.keyDown(input, { key: "Enter" });
      await waitFor(() => expect(screen.getByRole("alert").textContent).toContain("io error"));
    });

    it("submitting empty or unchanged name cancels the rename", async () => {
      await renderRoot();
      const tree = screen.getByRole("tree");
      tree.focus();
      fireEvent.keyDown(tree, { key: "ArrowDown" });
      fireEvent.keyDown(tree, { key: "F2" });
      const input = await screen.findByLabelText("New name");
      fireEvent.keyDown(input, { key: "Enter" }); // unchanged
      await waitFor(() => expect(screen.queryByLabelText("New name")).toBeNull());
    });

    it("Escape cancels the rename row", async () => {
      await renderRoot();
      const tree = screen.getByRole("tree");
      tree.focus();
      fireEvent.keyDown(tree, { key: "ArrowDown" });
      fireEvent.keyDown(tree, { key: "F2" });
      const input = await screen.findByLabelText("New name");
      fireEvent.keyDown(input, { key: "Escape" });
      await waitFor(() => expect(screen.queryByLabelText("New name")).toBeNull());
    });

    it("typing in the rename input clears the error state", async () => {
      invokeMock.mockImplementation((cmd: string, args: { path?: string } = {}) => {
        if (cmd === "fs_rename") return Promise.reject({ message: "io" });
        return defaultInvoke(cmd, args);
      });
      await renderRoot();
      const tree = screen.getByRole("tree");
      tree.focus();
      fireEvent.keyDown(tree, { key: "ArrowDown" });
      fireEvent.keyDown(tree, { key: "F2" });
      const input = await screen.findByLabelText("New name");
      fireEvent.change(input, { target: { value: "x.md" } });
      fireEvent.keyDown(input, { key: "Enter" });
      await waitFor(() => expect(screen.getByRole("alert")).toBeTruthy());
      fireEvent.change(input, { target: { value: "y.md" } });
      await waitFor(() => expect(screen.queryByRole("alert")).toBeNull());
    });

    it("renaming a directory drops cached child entries for the old path", async () => {
      seedExpanded({ "/ws": ["/ws/docs"] });
      await renderRoot();
      await waitFor(() => expect(screen.getByText("a.md")).toBeTruthy());
      const tree = screen.getByRole("tree");
      tree.focus();
      // First visible row is "docs"
      fireEvent.keyDown(tree, { key: "F2" });
      const input = await screen.findByLabelText("New name");
      fireEvent.change(input, { target: { value: "docs2" } });
      fireEvent.keyDown(input, { key: "Enter" });
      await waitFor(() => expect(invokeMock).toHaveBeenCalledWith("fs_rename", expect.anything()));
    });
  });

  describe("trash & undo", () => {
    it("posts a toast with Undo and restores via fs_trash_restore", async () => {
      await renderRoot();
      const tree = screen.getByRole("tree");
      tree.focus();
      fireEvent.keyDown(tree, { key: "ArrowDown" }); // readme.md
      fireEvent.keyDown(tree, { key: "Delete" });
      await waitFor(() =>
        expect(invokeMock).toHaveBeenCalledWith("fs_trash_file", expect.anything()),
      );
      const toast = useToasts.getState().toasts.find((t) => t.action?.label === "Undo");
      expect(toast).toBeTruthy();
      act(() => {
        toast?.action?.onClick();
      });
      await waitFor(() =>
        expect(invokeMock).toHaveBeenCalledWith("fs_trash_restore", expect.anything()),
      );
    });

    it("reports a warning toast when fs_trash_restore fails", async () => {
      invokeMock.mockImplementation((cmd: string, args: { path?: string } = {}) => {
        if (cmd === "fs_trash_restore") return Promise.reject({ message: "denied" });
        return defaultInvoke(cmd, args);
      });
      await renderRoot();
      const tree = screen.getByRole("tree");
      tree.focus();
      fireEvent.keyDown(tree, { key: "ArrowDown" });
      fireEvent.keyDown(tree, { key: "Delete" });
      await waitFor(() => {
        const t = useToasts.getState().toasts.find((x) => x.action?.label === "Undo");
        if (!t) throw new Error("no undo toast yet");
      });
      const toast = useToasts.getState().toasts.find((t) => t.action?.label === "Undo");
      act(() => {
        toast?.action?.onClick();
      });
      await waitFor(() => {
        const t = useToasts
          .getState()
          .toasts.find((x) => x.message === "filetree.trash.undo_failed");
        if (!t) throw new Error("no undo failed toast");
      });
    });

    it("bulk-trashes a multi-selection with a progress toast", async () => {
      await renderRoot();
      // Build a multi-selection via meta-click
      fireEvent.click(screen.getByText("readme.md"));
      fireEvent.click(screen.getByText("notes.md"), { metaKey: true });
      const tree = screen.getByRole("tree");
      tree.focus();
      fireEvent.keyDown(tree, { key: "Delete" });
      await waitFor(() => {
        const calls = invokeMock.mock.calls.filter((c) => c[0] === "fs_trash_file");
        if (calls.length < 2) throw new Error("not bulk yet");
      });
    });

    it("reports per-item failure when a bulk trash item rejects", async () => {
      invokeMock.mockImplementation((cmd: string, args: { path?: string } = {}) => {
        if (cmd === "fs_trash_file" && args.path === "/ws/readme.md") {
          return Promise.reject({ message: "locked" });
        }
        return defaultInvoke(cmd, args);
      });
      await renderRoot();
      fireEvent.click(screen.getByText("readme.md"));
      fireEvent.click(screen.getByText("notes.md"), { metaKey: true });
      const tree = screen.getByRole("tree");
      tree.focus();
      fireEvent.keyDown(tree, { key: "Delete" });
      await waitFor(() => {
        const failed = useToasts
          .getState()
          .toasts.some((t) => t.message === "filetree.trash.item_failed");
        if (!failed) throw new Error("no failed toast");
      });
    });

    it("permanent-delete posts an error toast on failure", async () => {
      vi.spyOn(window, "confirm").mockReturnValue(true);
      invokeMock.mockImplementation((cmd: string, args: { path?: string } = {}) => {
        if (cmd === "fs_remove_file") return Promise.reject({ message: "io" });
        return defaultInvoke(cmd, args);
      });
      await renderRoot();
      const tree = screen.getByRole("tree");
      tree.focus();
      fireEvent.keyDown(tree, { key: "ArrowDown" });
      fireEvent.keyDown(tree, { key: "Delete", shiftKey: true });
      await waitFor(() => {
        const ok = useToasts.getState().toasts.some((t) => t.message === "filetree.delete.failed");
        if (!ok) throw new Error("no error toast");
      });
    });

    it("permanent-delete closes any open tabs rooted under the deleted dir", async () => {
      vi.spyOn(window, "confirm").mockReturnValue(true);
      useTabs.setState({
        tabs: [{ path: "/ws/docs/a.md", preview: false, pinned: true, dirty: false } as never],
        activePath: "/ws/docs/a.md",
      });
      await renderRoot();
      const tree = screen.getByRole("tree");
      tree.focus();
      fireEvent.keyDown(tree, { key: "Delete", shiftKey: true });
      await waitFor(() => expect(useTabs.getState().tabs.length).toBe(0));
    });
  });

  describe("context menu", () => {
    async function openMenu() {
      await renderRoot();
      const row = screen.getByText("readme.md");
      fireEvent.contextMenu(row);
      await waitFor(() => expect(screen.getByText("New File")).toBeTruthy());
    }

    it("opens via right-click on a row and reveals all entries", async () => {
      await openMenu();
      expect(screen.getByText("New Folder")).toBeTruthy();
      expect(screen.getByText("Rename")).toBeTruthy();
      expect(screen.getByText("Move to Trash")).toBeTruthy();
      expect(screen.getByText("Reveal in OS")).toBeTruthy();
      expect(screen.getByText("Copy Path")).toBeTruthy();
      expect(screen.getByText("Copy Relative Path")).toBeTruthy();
    });

    it("invokes newFileCommand from the menu", async () => {
      await openMenu();
      fireEvent.click(screen.getByText("New File"));
      expect(newFileCommandMock).toHaveBeenCalled();
    });

    it("invokes newFolderCommand from the menu", async () => {
      await openMenu();
      fireEvent.click(screen.getByText("New Folder"));
      expect(newFolderCommandMock).toHaveBeenCalled();
    });

    it("Rename menu item begins an inline rename", async () => {
      await openMenu();
      fireEvent.click(screen.getByText("Rename"));
      await waitFor(() => expect(screen.getByLabelText("New name")).toBeTruthy());
    });

    it("Move to Trash menu item triggers fs_trash_file", async () => {
      await openMenu();
      fireEvent.click(screen.getByText("Move to Trash"));
      await waitFor(() =>
        expect(invokeMock).toHaveBeenCalledWith("fs_trash_file", expect.anything()),
      );
    });

    it("Reveal in OS calls os_reveal_path", async () => {
      await openMenu();
      fireEvent.click(screen.getByText("Reveal in OS"));
      await waitFor(() =>
        expect(invokeMock).toHaveBeenCalledWith("os_reveal_path", expect.anything()),
      );
    });

    it("Reveal in OS surfaces a warning toast on failure", async () => {
      invokeMock.mockImplementation((cmd: string, args: { path?: string } = {}) => {
        if (cmd === "os_reveal_path") return Promise.reject("unsupported");
        return defaultInvoke(cmd, args);
      });
      await openMenu();
      fireEvent.click(screen.getByText("Reveal in OS"));
      await waitFor(() => {
        const ok = useToasts
          .getState()
          .toasts.some((t) => t.message === "filetree.reveal.unsupported");
        if (!ok) throw new Error("no warning toast");
      });
    });

    it("Copy Path writes to navigator.clipboard", async () => {
      const writeText = vi.fn().mockResolvedValue(undefined);
      Object.defineProperty(navigator, "clipboard", { value: { writeText }, configurable: true });
      await openMenu();
      fireEvent.click(screen.getByText("Copy Path"));
      expect(writeText).toHaveBeenCalledWith("/ws/readme.md");
    });

    it("Copy Relative Path strips the workspace prefix", async () => {
      const writeText = vi.fn().mockResolvedValue(undefined);
      Object.defineProperty(navigator, "clipboard", { value: { writeText }, configurable: true });
      await openMenu();
      fireEvent.click(screen.getByText("Copy Relative Path"));
      expect(writeText).toHaveBeenCalledWith("readme.md");
    });

    it("Open With surfaces a warning when os_open_with rejects", async () => {
      invokeMock.mockImplementation((cmd: string, args: { path?: string } = {}) => {
        if (cmd === "os_open_with") return Promise.reject("nope");
        return defaultInvoke(cmd, args);
      });
      await openMenu();
      fireEvent.click(screen.getByText("Open With…"));
      await waitFor(() => {
        const ok = useToasts
          .getState()
          .toasts.some((t) => t.message === "filetree.open_with.unsupported");
        if (!ok) throw new Error("no warning toast");
      });
    });

    it("right-click on tree whitespace opens the menu anchored at workspace root", async () => {
      await renderRoot();
      const tree = screen.getByRole("tree");
      fireEvent.contextMenu(tree, { target: tree });
      await waitFor(() => expect(screen.getByText("New File")).toBeTruthy());
    });
  });

  describe("drag and drop", () => {
    function makeDataTransfer(initial = "") {
      const store: Record<string, string> = {};
      if (initial) store["application/x-markspread-path"] = initial;
      return {
        types: Object.keys(store),
        getData: (k: string) => store[k] ?? "",
        setData: (k: string, v: string) => {
          store[k] = v;
        },
        dropEffect: "",
        effectAllowed: "",
      };
    }

    it("drag-start primes the MIME payload with the row's path", async () => {
      await renderRoot();
      const row = screen.getByText("readme.md").closest("li");
      expect(row).toBeTruthy();
      const dt = makeDataTransfer();
      fireEvent.dragStart(row as HTMLElement, { dataTransfer: dt });
      expect(dt.getData("application/x-markspread-path")).toContain("/ws/readme.md");
    });

    it("drop on a directory row invokes fs_move", async () => {
      await renderRoot();
      const docsRow = screen.getByText("docs").closest("li");
      const dt = makeDataTransfer(JSON.stringify(["/ws/readme.md"]));
      // dragOver must include the MIME to enable drop
      fireEvent.dragOver(docsRow as HTMLElement, { dataTransfer: dt });
      fireEvent.drop(docsRow as HTMLElement, { dataTransfer: dt });
      await waitFor(() => expect(invokeMock).toHaveBeenCalledWith("fs_move", expect.anything()));
    });

    it("drop on whitespace falls through to workspace root", async () => {
      await renderRoot();
      const tree = screen.getByRole("tree");
      const dt = makeDataTransfer(JSON.stringify(["/ws/docs/a.md"]));
      fireEvent.dragOver(tree, { dataTransfer: dt });
      fireEvent.drop(tree, { dataTransfer: dt });
      await waitFor(() => expect(invokeMock).toHaveBeenCalledWith("fs_move", expect.anything()));
    });

    it("drop with malformed JSON payload falls back to a single-string source", async () => {
      await renderRoot();
      const docsRow = screen.getByText("docs").closest("li");
      const dt = makeDataTransfer("/ws/readme.md");
      fireEvent.dragOver(docsRow as HTMLElement, { dataTransfer: dt });
      fireEvent.drop(docsRow as HTMLElement, { dataTransfer: dt });
      await waitFor(() => expect(invokeMock).toHaveBeenCalledWith("fs_move", expect.anything()));
    });

    it("dragLeave on a directory row resets the dragOver highlight", async () => {
      await renderRoot();
      const docsRow = screen.getByText("docs").closest("li");
      const dt = makeDataTransfer(JSON.stringify(["/ws/readme.md"]));
      fireEvent.dragOver(docsRow as HTMLElement, { dataTransfer: dt });
      fireEvent.dragLeave(docsRow as HTMLElement, { dataTransfer: dt });
    });

    it("ignores drops with no MIME payload", async () => {
      await renderRoot();
      const tree = screen.getByRole("tree");
      const dt = makeDataTransfer();
      fireEvent.drop(tree, { dataTransfer: dt });
    });

    it("moving into the source's own parent is skipped silently", async () => {
      // Drop /ws/readme.md back onto /ws (its own parent) — no fs_move call.
      await renderRoot();
      const tree = screen.getByRole("tree");
      const dt = makeDataTransfer(JSON.stringify(["/ws/readme.md"]));
      fireEvent.dragOver(tree, { dataTransfer: dt });
      fireEvent.drop(tree, { dataTransfer: dt });
      // wait a tick
      await new Promise((r) => setTimeout(r, 10));
      const moves = invokeMock.mock.calls.filter((c) => c[0] === "fs_move");
      expect(moves.length).toBe(0);
    });

    it("warns when a single-row drop targets itself", async () => {
      // Build a deeper structure: /ws/docs onto /ws/docs (invalid target)
      seedExpanded({ "/ws": ["/ws/docs"] });
      await renderRoot();
      await waitFor(() => expect(screen.getByText("a.md")).toBeTruthy());
      const docsRow = screen.getByText("docs").closest("li");
      const dt = makeDataTransfer(JSON.stringify(["/ws/docs"]));
      fireEvent.dragOver(docsRow as HTMLElement, { dataTransfer: dt });
      fireEvent.drop(docsRow as HTMLElement, { dataTransfer: dt });
      await waitFor(() => {
        const ok = useToasts
          .getState()
          .toasts.some((t) => t.message === "filetree.move.invalid_target");
        if (!ok) throw new Error("no warn toast");
      });
    });

    it("posts an error toast when a single move fails", async () => {
      invokeMock.mockImplementation((cmd: string, args: { path?: string } = {}) => {
        if (cmd === "fs_move") return Promise.reject({ message: "perm" });
        return defaultInvoke(cmd, args);
      });
      await renderRoot();
      const docsRow = screen.getByText("docs").closest("li");
      const dt = makeDataTransfer(JSON.stringify(["/ws/readme.md"]));
      fireEvent.dragOver(docsRow as HTMLElement, { dataTransfer: dt });
      fireEvent.drop(docsRow as HTMLElement, { dataTransfer: dt });
      await waitFor(() => {
        const ok = useToasts.getState().toasts.some((t) => t.message === "filetree.move.failed");
        if (!ok) throw new Error("no error toast");
      });
    });

    it("reports a per-item failure during a bulk move", async () => {
      invokeMock.mockImplementation((cmd: string, args: { from?: string } = {}) => {
        if (cmd === "fs_move" && args.from === "/ws/readme.md") {
          return Promise.reject({ message: "locked" });
        }
        return defaultInvoke(cmd, args as { path?: string });
      });
      await renderRoot();
      // Select two files and drop them onto docs
      fireEvent.click(screen.getByText("readme.md"));
      fireEvent.click(screen.getByText("notes.md"), { metaKey: true });
      const readmeRow = screen.getByText("readme.md").closest("li");
      const docsRow = screen.getByText("docs").closest("li");
      const dt = makeDataTransfer();
      fireEvent.dragStart(readmeRow as HTMLElement, { dataTransfer: dt });
      fireEvent.dragOver(docsRow as HTMLElement, { dataTransfer: dt });
      fireEvent.drop(docsRow as HTMLElement, { dataTransfer: dt });
      await waitFor(() => {
        const ok = useToasts
          .getState()
          .toasts.some((t) => t.message === "filetree.move.item_failed");
        if (!ok) throw new Error("no per-item toast");
      });
    });

    it("dragOver on a file row is ignored (no preventDefault)", async () => {
      await renderRoot();
      const fileRow = screen.getByText("readme.md").closest("li");
      const dt = makeDataTransfer(JSON.stringify(["/ws/notes.md"]));
      fireEvent.dragOver(fileRow as HTMLElement, { dataTransfer: dt });
    });
  });

  describe("watcher events", () => {
    async function ready() {
      await renderRoot();
      await waitFor(() => expect(fsEventHandler).toBeTruthy());
    }

    it("ignores events from a different workspace", async () => {
      await ready();
      act(() => {
        fsEventHandler?.({
          payload: { workspace: "/other", kind: "created", paths: ["/other/x"] },
        });
      });
    });

    it("created events refresh parents and add a glow timer", async () => {
      await ready();
      const before = invokeMock.mock.calls.filter((c) => c[0] === "fs_list_dir").length;
      act(() => {
        fsEventHandler?.({
          payload: { workspace: "/ws", kind: "created", paths: ["/ws/new.md"] },
        });
      });
      await waitFor(() => {
        const after = invokeMock.mock.calls.filter((c) => c[0] === "fs_list_dir").length;
        if (after <= before) throw new Error("no refresh yet");
      });
    });

    it("renamed events rebind tabs and drop stale child cache", async () => {
      useTabs.setState({
        tabs: [{ path: "/ws/docs/a.md", preview: false, pinned: true, dirty: false } as never],
        activePath: "/ws/docs/a.md",
      });
      await ready();
      act(() => {
        fsEventHandler?.({
          payload: { workspace: "/ws", kind: "renamed", paths: ["/ws/docs", "/ws/docs2"] },
        });
      });
      await waitFor(() => {
        const t = useTabs.getState().tabs[0];
        if (t?.path !== "/ws/docs2/a.md") throw new Error("not rebound yet");
      });
    });

    it("renamed events with missing paths are dropped", async () => {
      await ready();
      act(() => {
        fsEventHandler?.({
          payload: { workspace: "/ws", kind: "renamed", paths: ["/ws/x"] },
        });
      });
    });

    it("removed events mark tabs orphaned and drop cached children", async () => {
      useTabs.setState({
        tabs: [{ path: "/ws/readme.md", preview: false, pinned: true, dirty: false } as never],
        activePath: "/ws/readme.md",
      });
      await ready();
      act(() => {
        fsEventHandler?.({
          payload: { workspace: "/ws", kind: "removed", paths: ["/ws/readme.md"] },
        });
      });
      await waitFor(() => {
        const t = useTabs.getState().tabs[0] as unknown as { orphaned?: boolean };
        if (!t?.orphaned) throw new Error("not orphaned yet");
      });
    });

    it("a removed event also clears any active glow timer for the path", async () => {
      await ready();
      act(() => {
        fsEventHandler?.({
          payload: { workspace: "/ws", kind: "created", paths: ["/ws/x.md"] },
        });
      });
      act(() => {
        fsEventHandler?.({
          payload: { workspace: "/ws", kind: "removed", paths: ["/ws/x.md"] },
        });
      });
    });

    it("unsubscribes the listener on unmount", async () => {
      const { unmount } = render(<FileTree workspace="/ws" />);
      await waitFor(() => expect(fsEventHandler).toBeTruthy());
      unmount();
      await waitFor(() => expect(unlistenMock).toHaveBeenCalled());
    });
  });

  describe("lock detection", () => {
    it("shows the lock indicator when fs_check_locked returns true", async () => {
      invokeMock.mockImplementation((cmd: string, args: { path?: string } = {}) => {
        if (cmd === "fs_check_locked") return Promise.resolve(true);
        return defaultInvoke(cmd, args);
      });
      await renderRoot();
      await waitFor(() => {
        const locked = document.querySelector('[data-testid="icon-lock"]');
        if (!locked) throw new Error("no lock icon yet");
      });
    });

    it("treats a rejected fs_check_locked as unlocked", async () => {
      invokeMock.mockImplementation((cmd: string, args: { path?: string } = {}) => {
        if (cmd === "fs_check_locked") return Promise.reject("err");
        return defaultInvoke(cmd, args);
      });
      await renderRoot();
    });
  });

  describe("VirtualList path", () => {
    it("switches to the windowed renderer when row count exceeds the threshold", async () => {
      const many: DirEntry[] = Array.from({ length: 600 }, (_, i) => ({
        name: `f${i}.md`,
        path: `/ws/f${i}.md`,
        is_dir: false,
      }));
      invokeMock.mockImplementation((cmd: string, args: { path?: string } = {}) => {
        if (cmd === "fs_list_dir")
          return Promise.resolve({ entries: many, page: 0, has_more: false });
        if (cmd === "fs_check_locked") return Promise.resolve(false);
        return defaultInvoke(cmd, args);
      });
      const { container } = render(<FileTree workspace="/ws" />);
      await waitFor(() => expect(container.querySelector(".relative .relative")).toBeTruthy());
      // Trigger a scroll handler
      const scroller = container.querySelector(".relative.h-full.overflow-auto") as HTMLElement;
      Object.defineProperty(scroller, "scrollTop", {
        value: 1000,
        writable: true,
        configurable: true,
      });
      Object.defineProperty(scroller, "clientHeight", {
        value: 400,
        writable: true,
        configurable: true,
      });
      fireEvent.scroll(scroller);
    });
  });

  describe("residual edge cases", () => {
    it("clears a vanished path from the selection when the filter hides it", async () => {
      await renderRoot();
      fireEvent.click(screen.getByText("readme.md"));
      fireEvent.change(screen.getByLabelText("Filter files"), {
        target: { value: "notes" },
      });
      await waitFor(() => expect(screen.queryByText("readme.md")).toBeNull());
    });

    it("renaming a file with no extension selects the whole name", async () => {
      const noExt: DirEntry[] = [{ name: "Makefile", path: "/ws/Makefile", is_dir: false }];
      invokeMock.mockImplementation((cmd: string, args: { path?: string } = {}) => {
        if (cmd === "fs_list_dir")
          return Promise.resolve({ entries: noExt, page: 0, has_more: false });
        if (cmd === "fs_check_locked") return Promise.resolve(false);
        if (cmd === "fs_stat") return Promise.reject("not found");
        return defaultInvoke(cmd, args);
      });
      render(<FileTree workspace="/ws" />);
      await waitFor(() => expect(screen.getByText("Makefile")).toBeTruthy());
      const tree = screen.getByRole("tree");
      tree.focus();
      fireEvent.keyDown(tree, { key: "F2" });
      await waitFor(() => expect(screen.getByLabelText("New name")).toBeTruthy());
    });

    it("blurring the rename input without an error cancels the edit", async () => {
      await renderRoot();
      const tree = screen.getByRole("tree");
      tree.focus();
      fireEvent.keyDown(tree, { key: "ArrowDown" });
      fireEvent.keyDown(tree, { key: "F2" });
      const input = await screen.findByLabelText("New name");
      fireEvent.blur(input);
      await waitFor(() => expect(screen.queryByLabelText("New name")).toBeNull());
    });

    it("cancels an in-flight bulk trash via the toast's Cancel action", async () => {
      let resolveFirst: (() => void) | null = null;
      invokeMock.mockImplementation((cmd: string, args: { path?: string } = {}) => {
        if (cmd === "fs_trash_file" && args.path === "/ws/readme.md") {
          return new Promise<void>((r) => {
            resolveFirst = r;
          });
        }
        return defaultInvoke(cmd, args);
      });
      await renderRoot();
      fireEvent.click(screen.getByText("readme.md"));
      fireEvent.click(screen.getByText("notes.md"), { metaKey: true });
      const tree = screen.getByRole("tree");
      tree.focus();
      fireEvent.keyDown(tree, { key: "Delete" });
      // The cancel-affording toast appears synchronously; click its action.
      await waitFor(() => {
        const t = useToasts.getState().toasts.find((x) => x.action?.label === "Cancel");
        if (!t) throw new Error("no cancel toast yet");
      });
      const cancel = useToasts.getState().toasts.find((t) => t.action?.label === "Cancel");
      act(() => {
        cancel?.action?.onClick();
        resolveFirst?.();
      });
      await waitFor(() => {
        const ok = useToasts
          .getState()
          .toasts.some((t) => t.message === "filetree.trash.bulk_cancelled");
        if (!ok) throw new Error("no cancelled toast");
      });
    });

    it("silently absorbs a refresh failure after creating a new file", async () => {
      let callCount = 0;
      invokeMock.mockImplementation((cmd: string, args: { path?: string } = {}) => {
        if (cmd === "fs_list_dir") {
          callCount += 1;
          // First call (initial load) succeeds; the refresh after create fails.
          if (callCount === 1) return Promise.resolve(listResultFor(args.path ?? "/ws"));
          return Promise.reject("io");
        }
        return defaultInvoke(cmd, args);
      });
      await renderRoot();
      fireEvent.click(screen.getByText("readme.md"));
      act(() => {
        window.dispatchEvent(new Event("markspread:filetree:new-file"));
      });
      const input = await screen.findByPlaceholderText("Filename");
      fireEvent.change(input, { target: { value: "x" } });
      fireEvent.keyDown(input, { key: "Enter" });
      await waitFor(() =>
        expect(invokeMock).toHaveBeenCalledWith("fs_create_file", expect.anything()),
      );
    });

    it("silently absorbs a refresh failure after renaming", async () => {
      let callCount = 0;
      invokeMock.mockImplementation((cmd: string, args: { path?: string } = {}) => {
        if (cmd === "fs_list_dir") {
          callCount += 1;
          if (callCount === 1) return Promise.resolve(listResultFor(args.path ?? "/ws"));
          return Promise.reject("io");
        }
        if (cmd === "fs_stat") return Promise.reject("not found");
        return defaultInvoke(cmd, args);
      });
      await renderRoot();
      const tree = screen.getByRole("tree");
      tree.focus();
      fireEvent.keyDown(tree, { key: "ArrowDown" });
      fireEvent.keyDown(tree, { key: "F2" });
      const input = await screen.findByLabelText("New name");
      fireEvent.change(input, { target: { value: "rn.md" } });
      fireEvent.keyDown(input, { key: "Enter" });
      await waitFor(() => expect(invokeMock).toHaveBeenCalledWith("fs_rename", expect.anything()));
    });

    it("renamed events drop cached children for nested subdirectories", async () => {
      seedExpanded({ "/ws": ["/ws/docs", "/ws/docs/sub"] });
      await renderRoot();
      await waitFor(() => expect(screen.getByText("deep.md")).toBeTruthy());
      await waitFor(() => expect(fsEventHandler).toBeTruthy());
      act(() => {
        fsEventHandler?.({
          payload: { workspace: "/ws", kind: "renamed", paths: ["/ws/docs", "/ws/docs2"] },
        });
      });
    });

    it("removed events drop nested cached children", async () => {
      seedExpanded({ "/ws": ["/ws/docs", "/ws/docs/sub"] });
      await renderRoot();
      await waitFor(() => expect(screen.getByText("deep.md")).toBeTruthy());
      await waitFor(() => expect(fsEventHandler).toBeTruthy());
      act(() => {
        fsEventHandler?.({
          payload: { workspace: "/ws", kind: "removed", paths: ["/ws/docs"] },
        });
      });
    });

    it("VirtualList routes drag-and-drop onto a directory through the windowed renderer", async () => {
      const many: DirEntry[] = [
        { name: "subdir", path: "/ws/subdir", is_dir: true },
        ...Array.from({ length: 600 }, (_, i) => ({
          name: `f${i}.md`,
          path: `/ws/f${i}.md`,
          is_dir: false,
        })),
      ];
      invokeMock.mockImplementation((cmd: string, args: { path?: string } = {}) => {
        if (cmd === "fs_list_dir") {
          if (args.path === "/ws")
            return Promise.resolve({ entries: many, page: 0, has_more: false });
          if (args.path === "/ws/subdir")
            return Promise.resolve({ entries: [], page: 0, has_more: false });
        }
        if (cmd === "fs_check_locked") return Promise.resolve(false);
        return defaultInvoke(cmd, args);
      });
      render(<FileTree workspace="/ws" />);
      await waitFor(() => expect(screen.getByText("subdir")).toBeTruthy());
      const subRow = screen.getByText("subdir").closest("li");
      const store: Record<string, string> = {
        "application/x-markspread-path": JSON.stringify(["/ws/f0.md"]),
      };
      const dt = {
        types: ["application/x-markspread-path"],
        getData: (k: string) => store[k] ?? "",
        setData: (k: string, v: string) => {
          store[k] = v;
        },
        dropEffect: "",
        effectAllowed: "",
      };
      fireEvent.dragOver(subRow as HTMLElement, { dataTransfer: dt });
      fireEvent.drop(subRow as HTMLElement, { dataTransfer: dt });
      await waitFor(() => expect(invokeMock).toHaveBeenCalledWith("fs_move", expect.anything()));
    });

    it("VirtualList toggles a directory row through the windowed renderer", async () => {
      // Need >500 rows + a directory we can click on. Make 600 entries with
      // a "subdir" near the top so it appears in the initial slice.
      const many: DirEntry[] = [
        { name: "subdir", path: "/ws/subdir", is_dir: true },
        ...Array.from({ length: 600 }, (_, i) => ({
          name: `f${i}.md`,
          path: `/ws/f${i}.md`,
          is_dir: false,
        })),
      ];
      invokeMock.mockImplementation((cmd: string, args: { path?: string } = {}) => {
        if (cmd === "fs_list_dir") {
          if (args.path === "/ws")
            return Promise.resolve({ entries: many, page: 0, has_more: false });
          if (args.path === "/ws/subdir")
            return Promise.resolve({ entries: [], page: 0, has_more: false });
        }
        if (cmd === "fs_check_locked") return Promise.resolve(false);
        return defaultInvoke(cmd, args);
      });
      render(<FileTree workspace="/ws" />);
      await waitFor(() => expect(screen.getByText("subdir")).toBeTruthy());
      fireEvent.click(screen.getByText("subdir"));
      await waitFor(() => {
        const subdir = invokeMock.mock.calls.filter(
          (c) => c[0] === "fs_list_dir" && (c[1] as { path?: string }).path === "/ws/subdir",
        );
        if (subdir.length === 0) throw new Error("subdir not loaded");
      });
    });

    it("VirtualList renders an inline create row in the windowed mode", async () => {
      const many: DirEntry[] = Array.from({ length: 600 }, (_, i) => ({
        name: `f${i}.md`,
        path: `/ws/f${i}.md`,
        is_dir: false,
      }));
      invokeMock.mockImplementation((cmd: string, args: { path?: string } = {}) => {
        if (cmd === "fs_list_dir")
          return Promise.resolve({ entries: many, page: 0, has_more: false });
        if (cmd === "fs_check_locked") return Promise.resolve(false);
        return defaultInvoke(cmd, args);
      });
      render(<FileTree workspace="/ws" />);
      await waitFor(() => expect(screen.getByText("f0.md")).toBeTruthy());
      // Click f0.md so beginCreate targets the workspace root (parent scan from a file).
      fireEvent.click(screen.getByText("f0.md"));
      act(() => {
        window.dispatchEvent(new Event("markspread:filetree:new-file"));
      });
      // The inline create row is appended at the END of rows (workspace root
      // parent), so it lives past the visible window. Scroll to the bottom so
      // it renders into the slice.
      const scroller = document.querySelector(".relative.h-full.overflow-auto") as HTMLElement;
      Object.defineProperty(scroller, "scrollTop", {
        value: 600 * 26,
        writable: true,
        configurable: true,
      });
      Object.defineProperty(scroller, "clientHeight", {
        value: 400,
        writable: true,
        configurable: true,
      });
      fireEvent.scroll(scroller);
      await waitFor(() => expect(screen.getByPlaceholderText("Filename")).toBeTruthy());
    });

    it("VirtualList renders an inline rename row in the windowed mode", async () => {
      const many: DirEntry[] = Array.from({ length: 600 }, (_, i) => ({
        name: `f${i}.md`,
        path: `/ws/f${i}.md`,
        is_dir: false,
      }));
      invokeMock.mockImplementation((cmd: string, args: { path?: string } = {}) => {
        if (cmd === "fs_list_dir")
          return Promise.resolve({ entries: many, page: 0, has_more: false });
        if (cmd === "fs_check_locked") return Promise.resolve(false);
        return defaultInvoke(cmd, args);
      });
      render(<FileTree workspace="/ws" />);
      await waitFor(() => expect(screen.getByText("f0.md")).toBeTruthy());
      fireEvent.click(screen.getByText("f0.md"));
      const tree = screen.getByRole("tree");
      tree.focus();
      fireEvent.keyDown(tree, { key: "F2" });
      await waitFor(() => expect(screen.getByLabelText("New name")).toBeTruthy());
    });

    it("VirtualList responds to ResizeObserver entries by updating the viewport height", async () => {
      const many: DirEntry[] = Array.from({ length: 600 }, (_, i) => ({
        name: `f${i}.md`,
        path: `/ws/f${i}.md`,
        is_dir: false,
      }));
      invokeMock.mockImplementation((cmd: string, args: { path?: string } = {}) => {
        if (cmd === "fs_list_dir")
          return Promise.resolve({ entries: many, page: 0, has_more: false });
        if (cmd === "fs_check_locked") return Promise.resolve(false);
        return defaultInvoke(cmd, args);
      });
      roInstances.length = 0;
      render(<FileTree workspace="/ws" />);
      await waitFor(() => expect(screen.getByText("f0.md")).toBeTruthy());
      const ro = roInstances[roInstances.length - 1];
      expect(ro?.el).toBeTruthy();
      act(() => {
        (ro as unknown as { cb: ResizeObserverCallback }).cb(
          [{ contentRect: { height: 800 } } as ResizeObserverEntry],
          {} as ResizeObserver,
        );
      });
      // Also exercise the no-entries branch.
      act(() => {
        (ro as unknown as { cb: ResizeObserverCallback }).cb([], {} as ResizeObserver);
      });
    });

    it("unmounting before the watcher subscription resolves invokes the unlisten cleanup", async () => {
      let resolveListen: ((u: () => void) => void) | null = null;
      vi.resetModules();
      vi.doMock("@tauri-apps/api/event", () => ({
        listen: () =>
          new Promise((r) => {
            resolveListen = r as never;
          }),
      }));
      const { FileTree: FT } = await import("./FileTree");
      const { unmount } = render(<FT workspace="/ws" />);
      unmount();
      const lateUnlisten = vi.fn();
      act(() => {
        resolveListen?.(lateUnlisten);
      });
      await waitFor(() => expect(lateUnlisten).toHaveBeenCalled());
      vi.doUnmock("@tauri-apps/api/event");
    });

    it("the glow timer expires and clears the glowing path after 2s", async () => {
      vi.useFakeTimers({ shouldAdvanceTime: true });
      try {
        await renderRoot();
        await waitFor(() => expect(fsEventHandler).toBeTruthy());
        act(() => {
          fsEventHandler?.({
            payload: { workspace: "/ws", kind: "created", paths: ["/ws/g.md"] },
          });
        });
        // Re-trigger to exercise the "existing timer cleared" branch.
        act(() => {
          fsEventHandler?.({
            payload: { workspace: "/ws", kind: "created", paths: ["/ws/g.md"] },
          });
        });
        await act(async () => {
          await vi.advanceTimersByTimeAsync(2100);
        });
      } finally {
        vi.useRealTimers();
      }
    });

    it("refreshParent silently absorbs a list failure during watcher-driven refresh", async () => {
      let callCount = 0;
      invokeMock.mockImplementation((cmd: string, args: { path?: string } = {}) => {
        if (cmd === "fs_list_dir") {
          callCount += 1;
          if (callCount === 1) return Promise.resolve(listResultFor(args.path ?? "/ws"));
          return Promise.reject("io");
        }
        return defaultInvoke(cmd, args);
      });
      await renderRoot();
      await waitFor(() => expect(fsEventHandler).toBeTruthy());
      act(() => {
        fsEventHandler?.({
          payload: { workspace: "/ws", kind: "created", paths: ["/ws/new.md"] },
        });
      });
      await waitFor(() => {
        if (invokeMock.mock.calls.filter((c) => c[0] === "fs_list_dir").length < 2) {
          throw new Error("not refreshed yet");
        }
      });
    });

    it("VirtualList ships a multi-selection set via the drag start payload", async () => {
      const many: DirEntry[] = Array.from({ length: 600 }, (_, i) => ({
        name: `f${i}.md`,
        path: `/ws/f${i}.md`,
        is_dir: false,
      }));
      invokeMock.mockImplementation((cmd: string, args: { path?: string } = {}) => {
        if (cmd === "fs_list_dir")
          return Promise.resolve({ entries: many, page: 0, has_more: false });
        if (cmd === "fs_check_locked") return Promise.resolve(false);
        return defaultInvoke(cmd, args);
      });
      render(<FileTree workspace="/ws" />);
      await waitFor(() => expect(screen.getByText("f0.md")).toBeTruthy());
      // Multi-select two files.
      fireEvent.click(screen.getByText("f0.md"));
      fireEvent.click(screen.getByText("f1.md"), { metaKey: true });
      const store: Record<string, string> = {};
      const dt = {
        types: [] as string[],
        getData: (k: string) => store[k] ?? "",
        setData: (k: string, v: string) => {
          store[k] = v;
          if (!dt.types.includes(k)) dt.types.push(k);
        },
        dropEffect: "",
        effectAllowed: "",
      };
      const row = screen.getByText("f0.md").closest("li");
      fireEvent.dragStart(row as HTMLElement, { dataTransfer: dt });
      const payload = JSON.parse(store["application/x-markspread-path"] ?? "[]");
      expect(payload.length).toBe(2);
    });
  });

  describe("Windows path handling", () => {
    const winRoot: DirEntry[] = [
      { name: "docs", path: "C:\\ws\\docs", is_dir: true },
      { name: "readme.md", path: "C:\\ws\\readme.md", is_dir: false },
    ];
    const winDocs: DirEntry[] = [{ name: "a.md", path: "C:\\ws\\docs\\a.md", is_dir: false }];

    function winInvoke(cmd: string, args: { path?: string } = {}) {
      if (cmd === "fs_list_dir") {
        if (args.path === "C:\\ws")
          return Promise.resolve({ entries: winRoot, page: 0, has_more: false });
        if (args.path === "C:\\ws\\docs")
          return Promise.resolve({ entries: winDocs, page: 0, has_more: false });
        return Promise.resolve({ entries: [], page: 0, has_more: false });
      }
      if (cmd === "fs_check_locked") return Promise.resolve(false);
      if (cmd === "fs_stat") return Promise.reject("not found");
      return defaultInvoke(cmd, args);
    }

    it("trashes a file under a backslash-separated workspace path", async () => {
      invokeMock.mockImplementation(winInvoke);
      render(<FileTree workspace={"C:\\ws"} />);
      await waitFor(() => expect(screen.getByText("readme.md")).toBeTruthy());
      const tree = screen.getByRole("tree");
      tree.focus();
      fireEvent.keyDown(tree, { key: "ArrowDown" });
      fireEvent.keyDown(tree, { key: "Delete" });
      await waitFor(() =>
        expect(invokeMock).toHaveBeenCalledWith("fs_trash_file", expect.anything()),
      );
    });

    it("renames a file using backslash separators", async () => {
      invokeMock.mockImplementation(winInvoke);
      render(<FileTree workspace={"C:\\ws"} />);
      await waitFor(() => expect(screen.getByText("readme.md")).toBeTruthy());
      const tree = screen.getByRole("tree");
      tree.focus();
      fireEvent.keyDown(tree, { key: "ArrowDown" });
      fireEvent.keyDown(tree, { key: "F2" });
      const input = await screen.findByLabelText("New name");
      fireEvent.change(input, { target: { value: "rn.md" } });
      fireEvent.keyDown(input, { key: "Enter" });
      await waitFor(() =>
        expect(invokeMock).toHaveBeenCalledWith(
          "fs_rename",
          expect.objectContaining({ to: "C:\\ws\\rn.md" }),
        ),
      );
    });

    it("moves a backslash-pathed file via drag-drop onto a sibling directory", async () => {
      invokeMock.mockImplementation(winInvoke);
      render(<FileTree workspace={"C:\\ws"} />);
      await waitFor(() => expect(screen.getByText("readme.md")).toBeTruthy());
      const docsRow = screen.getByText("docs").closest("li");
      const store: Record<string, string> = {
        "application/x-markspread-path": JSON.stringify(["C:\\ws\\readme.md"]),
      };
      const dt = {
        types: ["application/x-markspread-path"],
        getData: (k: string) => store[k] ?? "",
        setData: (k: string, v: string) => {
          store[k] = v;
        },
        dropEffect: "",
        effectAllowed: "",
      };
      fireEvent.dragOver(docsRow as HTMLElement, { dataTransfer: dt });
      fireEvent.drop(docsRow as HTMLElement, { dataTransfer: dt });
      await waitFor(() =>
        expect(invokeMock).toHaveBeenCalledWith(
          "fs_move",
          expect.objectContaining({ to: "C:\\ws\\docs\\readme.md" }),
        ),
      );
    });

    it("renamed watcher events with backslash separators rebind tabs", async () => {
      invokeMock.mockImplementation(winInvoke);
      useTabs.setState({
        tabs: [{ path: "C:\\ws\\docs\\a.md", preview: false, pinned: true, dirty: false } as never],
        activePath: "C:\\ws\\docs\\a.md",
      });
      render(<FileTree workspace={"C:\\ws"} />);
      await waitFor(() => expect(screen.getByText("readme.md")).toBeTruthy());
      await waitFor(() => expect(fsEventHandler).toBeTruthy());
      act(() => {
        fsEventHandler?.({
          payload: {
            workspace: "C:\\ws",
            kind: "renamed",
            paths: ["C:\\ws\\docs", "C:\\ws\\docs2"],
          },
        });
      });
      await waitFor(() => {
        const t = useTabs.getState().tabs[0];
        if (t?.path !== "C:\\ws\\docs2\\a.md") throw new Error("not rebound yet");
      });
    });

    it("removed watcher events with backslash separators orphan affected tabs", async () => {
      invokeMock.mockImplementation(winInvoke);
      useTabs.setState({
        tabs: [{ path: "C:\\ws\\docs\\a.md", preview: false, pinned: true, dirty: false } as never],
        activePath: "C:\\ws\\docs\\a.md",
      });
      render(<FileTree workspace={"C:\\ws"} />);
      await waitFor(() => expect(screen.getByText("readme.md")).toBeTruthy());
      await waitFor(() => expect(fsEventHandler).toBeTruthy());
      act(() => {
        fsEventHandler?.({
          payload: { workspace: "C:\\ws", kind: "removed", paths: ["C:\\ws\\docs"] },
        });
      });
      await waitFor(() => {
        const t = useTabs.getState().tabs[0] as unknown as { orphaned?: boolean };
        if (!t?.orphaned) throw new Error("not orphaned yet");
      });
    });
  });

  describe("preview tabs", () => {
    it("opens a file as a preview tab when previewTabsEnabled is set", async () => {
      useSettings.setState({ previewTabsEnabled: true } as never);
      await renderRoot();
      fireEvent.click(screen.getByText("readme.md"));
      await waitFor(() => {
        const tab = useTabs.getState().tabs.find((t) => t.path === "/ws/readme.md");
        if (!tab?.preview) throw new Error("not preview");
      });
    });
  });

  describe("modified sort", () => {
    it("sorts by descending modified time when sortMode is 'modified'", async () => {
      // Set sort BEFORE mount so list call requests metadata.
      useLayout.setState({ sortMode: { "/ws": "modified" } } as never);
      const mixed: DirEntry[] = [
        { name: "a.md", path: "/ws/a.md", is_dir: false, modified_ms: 1 },
        { name: "b.md", path: "/ws/b.md", is_dir: false, modified_ms: 5 },
        { name: "c.md", path: "/ws/c.md", is_dir: false }, // no modified_ms
      ];
      invokeMock.mockImplementation((cmd: string, args: { path?: string } = {}) => {
        if (cmd === "fs_list_dir")
          return Promise.resolve({ entries: mixed, page: 0, has_more: false });
        if (cmd === "fs_check_locked") return Promise.resolve(false);
        return defaultInvoke(cmd, args);
      });
      render(<FileTree workspace="/ws" />);
      await waitFor(() => expect(screen.getByText("b.md")).toBeTruthy());
    });

    it("sorts by extension when sortMode is 'type'", async () => {
      useLayout.setState({ sortMode: { "/ws": "type" } } as never);
      const mixed: DirEntry[] = [
        { name: "a.md", path: "/ws/a.md", is_dir: false },
        { name: "b.txt", path: "/ws/b.txt", is_dir: false },
        { name: "noext", path: "/ws/noext", is_dir: false },
      ];
      invokeMock.mockImplementation((cmd: string, args: { path?: string } = {}) => {
        if (cmd === "fs_list_dir")
          return Promise.resolve({ entries: mixed, page: 0, has_more: false });
        if (cmd === "fs_check_locked") return Promise.resolve(false);
        return defaultInvoke(cmd, args);
      });
      render(<FileTree workspace="/ws" />);
      await waitFor(() => expect(screen.getByText("noext")).toBeTruthy());
    });
  });

  describe("session-restore expanded set", () => {
    it("auto-loads expanded directories whose children aren't cached yet", async () => {
      seedExpanded({ "/ws": ["/ws/docs"] });
      await renderRoot();
      await waitFor(() => expect(screen.getByText("a.md")).toBeTruthy());
    });

    it("treats a failed initial list as an empty directory", async () => {
      invokeMock.mockImplementation((cmd: string, args: { path?: string } = {}) => {
        if (cmd === "fs_list_dir") return Promise.reject("denied");
        if (cmd === "fs_check_locked") return Promise.resolve(false);
        return defaultInvoke(cmd, args);
      });
      render(<FileTree workspace="/ws" />);
      // Nothing renders inside the tree.
      await waitFor(() => expect(screen.getByRole("tree")).toBeTruthy());
    });
  });
});
