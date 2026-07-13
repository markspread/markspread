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

let lastEditorProps: {
  initialDoc: string;
  language?: string;
  path?: string;
  readOnly?: boolean;
  onChange?: (doc: string) => void;
  tabId?: string;
} | null = null;
vi.mock("../components/Editor", () => ({
  Editor: (props: {
    initialDoc: string;
    language?: string;
    path?: string;
    readOnly?: boolean;
    onChange?: (doc: string) => void;
    tabId?: string;
  }) => {
    lastEditorProps = props;
    return <div data-testid="editor-mock">{props.initialDoc}</div>;
  },
}));

import { SingleFile } from "../screens/SingleFile";
import { useSingleFile } from "../store/single-file";
import { useToasts } from "../store/toasts";
import { useWorkspace } from "../store/workspace";

afterEach(cleanup);

describe("screens/SingleFile", () => {
  beforeEach(() => {
    invoke.mockReset();
    invoke.mockImplementation(() => Promise.resolve(undefined));
    useSingleFile.setState({ path: null, content: "", dirty: false });
    useWorkspace.setState({ current: null } as never);
    useToasts.setState({ toasts: [] });
    lastEditorProps = null;
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

  it("pushes an error toast when the save invoke rejects", async () => {
    invoke.mockImplementation((cmd: unknown) =>
      cmd === "fs_write" ? Promise.reject("EPERM") : Promise.resolve(undefined),
    );
    useSingleFile.setState({ path: "/docs/note.md", content: "hello", dirty: true });
    render(<SingleFile />);
    await act(async () => {
      fireEvent.click(screen.getByTestId("single-file-save"));
    });
    const toasts = useToasts.getState().toasts;
    expect(toasts.some((t) => t.kind === "error")).toBe(true);
    // dirty stays true because save failed
    expect(useSingleFile.getState().dirty).toBe(true);
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

  it("Ctrl+S triggers save", async () => {
    useSingleFile.setState({ path: "/docs/note.md", content: "x", dirty: true });
    render(<SingleFile />);
    await act(async () => {
      const evt = new KeyboardEvent("keydown", { key: "s", ctrlKey: true, bubbles: true });
      window.dispatchEvent(evt);
    });
    expect(invoke).toHaveBeenCalledWith(
      "fs_write",
      expect.objectContaining({ path: "/docs/note.md" }),
    );
  });

  it("uses the plain language for a non-markdown single file", () => {
    useSingleFile.setState({ path: "/docs/script.txt", content: "x", dirty: false });
    render(<SingleFile />);
    // Editor mounts; the non-md path drives the `isMd ? "markdown" : "plain"` else arm.
    expect(screen.getByTestId("single-file-editor")).toBeTruthy();
    expect(lastEditorProps?.language).toBe("plain");
  });

  it("mounts a non-md single file read-only with the path for lazy highlight (ADR-0014 T2.c)", () => {
    useSingleFile.setState({ path: "/docs/config.json", content: "{}", dirty: false });
    render(<SingleFile />);
    expect(lastEditorProps?.language).toBe("plain");
    expect(lastEditorProps?.path).toBe("/docs/config.json");
    expect(lastEditorProps?.readOnly).toBe(true);
  });

  it("keeps markdown single files editable (readOnly off)", () => {
    useSingleFile.setState({ path: "/docs/note.md", content: "x", dirty: false });
    render(<SingleFile />);
    expect(lastEditorProps?.readOnly).toBe(false);
    expect(lastEditorProps?.path).toBe("/docs/note.md");
  });

  it("forwards Editor onChange edits into the single-file store", () => {
    useSingleFile.setState({ path: "/docs/note.md", content: "old", dirty: false });
    render(<SingleFile />);
    act(() => lastEditorProps?.onChange?.("edited"));
    expect(useSingleFile.getState().content).toBe("edited");
  });

  it("ignores Cmd+S when no file is open (save early-returns)", async () => {
    useSingleFile.setState({ path: null, content: "", dirty: false });
    render(<SingleFile />);
    await act(async () => {
      window.dispatchEvent(
        new KeyboardEvent("keydown", { key: "s", metaKey: true, bubbles: true }),
      );
    });
    expect(invoke).not.toHaveBeenCalledWith("fs_write", expect.anything());
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
