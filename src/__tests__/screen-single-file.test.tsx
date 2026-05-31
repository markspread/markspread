// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

if (typeof Element !== "undefined" && !Element.prototype.scrollIntoView) {
  Element.prototype.scrollIntoView = () => {};
}
if (typeof globalThis.ResizeObserver === "undefined") {
  class FakeRO {
    observe() {}
    unobserve() {}
    disconnect() {}
  }
  (globalThis as unknown as { ResizeObserver: typeof FakeRO }).ResizeObserver = FakeRO;
}

const invoke = vi.fn((..._args: unknown[]) => Promise.resolve(undefined));
vi.mock("@tauri-apps/api/core", () => ({
  invoke: (...args: unknown[]) => invoke(...args),
}));

import { SingleFile } from "../screens/SingleFile";
import { useSingleFile } from "../store/single-file";
import { useWorkspace } from "../store/workspace";

afterEach(cleanup);

describe("screens/SingleFile", () => {
  beforeEach(() => {
    invoke.mockReset();
    invoke.mockImplementation(() => Promise.resolve(undefined));
    useSingleFile.setState({ path: null, content: "", dirty: false });
    useWorkspace.setState({ current: null } as never);
  });

  it("renders nothing without an open file", () => {
    const { container } = render(<SingleFile />);
    expect(container.firstChild).toBeNull();
  });

  it("mounts CodeMirror Editor for an open file (FIX: was raw textarea)", () => {
    useSingleFile.setState({ path: "/docs/note.md", content: "hello", dirty: false });
    render(<SingleFile />);
    expect(screen.getByLabelText("Single file view")).toBeTruthy();
    expect(screen.getByTestId("single-file-editor")).toBeTruthy();
  });

  it("shows the unsaved indicator when dirty", () => {
    useSingleFile.setState({ path: "/docs/note.md", content: "x", dirty: true });
    render(<SingleFile />);
    expect(screen.getByTestId("single-file-dirty-badge")).toBeTruthy();
  });

  it("save button disabled when not dirty, enabled when dirty", () => {
    useSingleFile.setState({ path: "/docs/note.md", content: "x", dirty: false });
    const { rerender } = render(<SingleFile />);
    expect((screen.getByTestId("single-file-save") as HTMLButtonElement).disabled).toBe(true);
    useSingleFile.setState({ path: "/docs/note.md", content: "x", dirty: true });
    rerender(<SingleFile />);
    expect((screen.getByTestId("single-file-save") as HTMLButtonElement).disabled).toBe(false);
  });

  it("save button calls fs_write with workspace + path + content (FIX: was no-save)", async () => {
    useSingleFile.setState({ path: "/docs/note.md", content: "hello", dirty: true });
    render(<SingleFile />);
    await act(async () => {
      fireEvent.click(screen.getByTestId("single-file-save"));
    });
    expect(invoke).toHaveBeenCalledWith("fs_write", {
      workspace: "/docs",
      path: "/docs/note.md",
      content: "hello",
    });
    // dirty flag cleared
    expect(useSingleFile.getState().dirty).toBe(false);
  });

  it("Cmd+S triggers save", async () => {
    useSingleFile.setState({ path: "/docs/note.md", content: "x", dirty: true });
    render(<SingleFile />);
    await act(async () => {
      const evt = new KeyboardEvent("keydown", { key: "s", metaKey: true, bubbles: true });
      window.dispatchEvent(evt);
    });
    expect(invoke).toHaveBeenCalledWith(
      "fs_write",
      expect.objectContaining({ path: "/docs/note.md" }),
    );
  });

  it("closes the single file", () => {
    useSingleFile.setState({ path: "/docs/note.md", content: "x", dirty: false });
    render(<SingleFile />);
    fireEvent.click(screen.getByText("Close"));
    expect(useSingleFile.getState().path).toBeNull();
  });

  it("converts the folder to a workspace", async () => {
    useSingleFile.setState({ path: "/docs/note.md", content: "x", dirty: false });
    render(<SingleFile />);
    await act(async () => {
      fireEvent.click(screen.getByText("Convert folder to workspace"));
    });
    expect(invoke).toHaveBeenCalledWith("workspace_scaffold", { workspace: "/docs" });
  });
});
