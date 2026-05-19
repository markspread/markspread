// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

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
    useSingleFile.setState({ path: null, content: "", dirty: false });
    useWorkspace.setState({ current: null } as never);
  });

  it("renders nothing without an open file", () => {
    const { container } = render(<SingleFile />);
    expect(container.firstChild).toBeNull();
  });

  it("renders the single-file editor for an open file", () => {
    useSingleFile.setState({ path: "/docs/note.md", content: "hello", dirty: false });
    render(<SingleFile />);
    expect(screen.getByLabelText("Single file view")).toBeTruthy();
    expect(screen.getByDisplayValue("hello")).toBeTruthy();
  });

  it("updates content and marks the file dirty", () => {
    useSingleFile.setState({ path: "/docs/note.md", content: "hello", dirty: false });
    render(<SingleFile />);
    fireEvent.change(screen.getByLabelText("File contents"), {
      target: { value: "changed" },
    });
    expect(useSingleFile.getState().content).toBe("changed");
    expect(useSingleFile.getState().dirty).toBe(true);
  });

  it("shows the unsaved indicator when dirty", () => {
    useSingleFile.setState({ path: "/docs/note.md", content: "x", dirty: true });
    render(<SingleFile />);
    expect(screen.getByText("Unsaved")).toBeTruthy();
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
