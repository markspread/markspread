import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const invokeMock = vi.fn();
vi.mock("@tauri-apps/api/core", () => ({
  invoke: (cmd: string, args: unknown) => invokeMock(cmd, args),
}));
vi.mock("@tauri-apps/api/event", () => ({
  listen: () => Promise.resolve(() => {}),
}));

import { useFileTree } from "../store/file-tree";
import { useLayout } from "../store/layout";
import { useTabs } from "../store/tabs";
import { FileTree } from "./FileTree";

interface DirEntry {
  name: string;
  path: string;
  is_dir: boolean;
}

const rootEntries: DirEntry[] = [
  { name: "docs", path: "/ws/docs", is_dir: true },
  { name: "readme.md", path: "/ws/readme.md", is_dir: false },
  { name: "notes.md", path: "/ws/notes.md", is_dir: false },
];

function listResult(entries: DirEntry[]) {
  return { entries, page: 0, has_more: false };
}

afterEach(cleanup);

describe("FileTree", () => {
  beforeEach(() => {
    invokeMock.mockReset();
    invokeMock.mockImplementation((cmd: string) => {
      if (cmd === "fs_list_dir") return Promise.resolve(listResult(rootEntries));
      if (cmd === "fs_check_locked") return Promise.resolve(false);
      return Promise.resolve(undefined);
    });
    useFileTree.setState({ expanded: {} });
    useTabs.setState({ tabs: [], activePath: null });
  });
  afterEach(() => {
    useFileTree.setState({ expanded: {} });
  });

  it("renders the workspace root listing", async () => {
    render(<FileTree workspace="/ws" />);
    await waitFor(() => expect(screen.getByText("readme.md")).toBeTruthy());
    expect(screen.getByText("docs")).toBeTruthy();
    expect(screen.getByRole("tree")).toBeTruthy();
  });

  it("filters rows by the fuzzy filter input", async () => {
    render(<FileTree workspace="/ws" />);
    await waitFor(() => expect(screen.getByText("readme.md")).toBeTruthy());
    fireEvent.change(screen.getByLabelText("Filter files"), {
      target: { value: "notes" },
    });
    await waitFor(() => expect(screen.queryByText("readme.md")).toBeNull());
    expect(screen.getByText("notes.md")).toBeTruthy();
  });

  it("opens a file when its row is clicked", async () => {
    const openSpy = vi.fn();
    useTabs.setState({ open: openSpy } as never);
    render(<FileTree workspace="/ws" />);
    await waitFor(() => expect(screen.getByText("readme.md")).toBeTruthy());
    fireEvent.click(screen.getByText("readme.md"));
    expect(openSpy).toHaveBeenCalledWith("/ws/readme.md", expect.any(Object));
  });

  it("cycles the sort mode via the sort button", async () => {
    render(<FileTree workspace="/ws" />);
    await waitFor(() => expect(screen.getByText("readme.md")).toBeTruthy());
    const before = useLayout.getState().getSortMode("/ws");
    fireEvent.click(screen.getByLabelText("Sort mode"));
    expect(useLayout.getState().getSortMode("/ws")).not.toBe(before);
  });

  it("toggles folders-first and show-hidden", async () => {
    render(<FileTree workspace="/ws" />);
    await waitFor(() => expect(screen.getByText("readme.md")).toBeTruthy());
    fireEvent.click(screen.getByLabelText("Folders first"));
    fireEvent.click(screen.getByLabelText("Show hidden files"));
  });
});
