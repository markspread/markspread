import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { PaneNode } from "../lib/editor/layout-model";
import type { EditorPosition } from "../store/tabs";

vi.mock("@tauri-apps/api/core", () => ({
  invoke: () => Promise.resolve({ content: "hi", encoding: "utf-8", mtime: 1, sha256: "x" }),
  convertFileSrc: (p: string) => p,
}));
vi.mock("./Editor", () => ({
  Editor: () => <div data-testid="editor-mock">editor</div>,
}));
vi.mock("./SpreadPane", () => ({
  SpreadPane: () => <div data-testid="spread-mock">spread</div>,
}));

import { useDocCache } from "../store/doc-cache";
import { PaneEditor } from "./PaneEditor";

afterEach(cleanup);

const POS: EditorPosition = { line: 0, column: 0, scrollTop: 0 };

function paneWith(path: string | null): PaneNode {
  if (!path) return { type: "pane", id: "pane-1", tabs: [], activeTabId: null };
  return {
    type: "pane",
    id: "pane-1",
    tabs: [{ id: "tab-1", path, position: POS }],
    activeTabId: "tab-1",
  };
}

describe("PaneEditor", () => {
  beforeEach(() => {
    useDocCache.setState({ baselines: {}, live: {}, errors: {}, reloadEpoch: {} });
  });

  it("renders the empty hint when no tab is active", () => {
    render(<PaneEditor workspace="/ws" pane={paneWith(null)} />);
    expect(screen.getByText("Open a file from the sidebar to start reviewing.")).toBeTruthy();
  });

  it("renders the loading state before the baseline arrives", () => {
    render(<PaneEditor workspace="/ws" pane={paneWith("/ws/a.md")} />);
    expect(screen.getByText("Loading…")).toBeTruthy();
  });

  it("renders the editor once a baseline is cached", () => {
    useDocCache.getState().setBaseline("/ws", "/ws/a.md", {
      content: "hello",
      encoding: "utf-8",
      mtime: 1,
      sha256: "x",
    });
    render(<PaneEditor workspace="/ws" pane={paneWith("/ws/a.md")} />);
    expect(screen.getByTestId("editor-mock")).toBeTruthy();
  });

  it("renders the non-text viewer for image files", () => {
    render(<PaneEditor workspace="/ws" pane={paneWith("/ws/pic.png")} />);
    expect(screen.getByLabelText("Image preview")).toBeTruthy();
  });
});
