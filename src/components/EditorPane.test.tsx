import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const invokeMock = vi.fn();
vi.mock("@tauri-apps/api/core", () => ({
  invoke: (cmd: string, args: unknown) => invokeMock(cmd, args),
  convertFileSrc: (p: string) => `asset://${p}`,
}));
vi.mock("./Editor", () => ({
  Editor: ({ initialDoc }: { initialDoc: string }) => <div data-testid="editor">{initialDoc}</div>,
}));

import { useTabs } from "../store/tabs";
import { useWorkspace } from "../store/workspace";
import { EditorPane } from "./EditorPane";

afterEach(cleanup);

describe("EditorPane", () => {
  beforeEach(() => {
    invokeMock.mockReset();
    useTabs.setState({ tabs: [], activePath: null });
    useWorkspace.setState({ readOnly: false });
  });
  afterEach(() => {
    useTabs.setState({ tabs: [], activePath: null });
  });

  it("renders the empty hint when no file is open", () => {
    render(<EditorPane workspace="/ws" />);
    expect(screen.getByLabelText("Editor (no file open)")).toBeTruthy();
  });

  it("renders the editor once a text file loads", async () => {
    invokeMock.mockResolvedValue({ content: "# Title", encoding: "utf-8" });
    useTabs.setState({ activePath: "/ws/note.md" });
    render(<EditorPane workspace="/ws" />);
    await waitFor(() => expect(screen.getByTestId("editor")).toBeTruthy());
    expect(screen.getByTestId("editor").textContent).toBe("# Title");
  });

  it("shows the access error card on a read failure", async () => {
    invokeMock.mockRejectedValue("EACCES");
    useTabs.setState({ activePath: "/ws/secret.md" });
    render(<EditorPane workspace="/ws" />);
    await waitFor(() => expect(screen.getByLabelText("Editor error")).toBeTruthy());
  });

  it("shows the non-text viewer for binary files", () => {
    useTabs.setState({ activePath: "/ws/pic.png" });
    render(<EditorPane workspace="/ws" />);
    expect(screen.getByLabelText("Image preview")).toBeTruthy();
  });
});
