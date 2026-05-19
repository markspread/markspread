// open-md-file: single-file dialog open + parentDir helper.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useSingleFile } from "../store/single-file";

const invokeMock = vi.fn();
const openDialogMock = vi.fn();
vi.mock("@tauri-apps/api/core", () => ({
  invoke: (...args: unknown[]) => invokeMock(...args),
}));
vi.mock("@tauri-apps/plugin-dialog", () => ({
  open: (...args: unknown[]) => openDialogMock(...args),
}));

beforeEach(() => {
  invokeMock.mockReset();
  openDialogMock.mockReset();
  useSingleFile.setState({ path: null, content: "" });
});

afterEach(() => {
  invokeMock.mockReset();
  openDialogMock.mockReset();
});

describe("parentDir", () => {
  it("returns the unix parent directory", async () => {
    const { parentDir } = await import("./open-md-file");
    expect(parentDir("/a/b/c.md")).toBe("/a/b");
  });

  it("returns the windows parent directory", async () => {
    const { parentDir } = await import("./open-md-file");
    expect(parentDir("C:\\a\\b\\c.md")).toBe("C:\\a\\b");
  });

  it("returns the path itself when there is no parent", async () => {
    const { parentDir } = await import("./open-md-file");
    expect(parentDir("file.md")).toBe("file.md");
  });

  it("returns the path itself when separator is at index 0", async () => {
    const { parentDir } = await import("./open-md-file");
    expect(parentDir("/file.md")).toBe("/file.md");
  });
});

describe("openSingleMdFromDialog", () => {
  it("returns null when the dialog is cancelled", async () => {
    openDialogMock.mockResolvedValueOnce(null);
    const { openSingleMdFromDialog } = await import("./open-md-file");
    expect(await openSingleMdFromDialog()).toBeNull();
    expect(invokeMock).not.toHaveBeenCalled();
  });

  it("returns null when the dialog yields an empty string", async () => {
    openDialogMock.mockResolvedValueOnce("");
    const { openSingleMdFromDialog } = await import("./open-md-file");
    expect(await openSingleMdFromDialog()).toBeNull();
  });

  it("reads the selected file and opens single-file mode", async () => {
    openDialogMock.mockResolvedValueOnce("/notes/a.md");
    invokeMock.mockResolvedValueOnce({
      text: "hello",
      encoding: "utf-8",
      bytes: 5,
      truncated: false,
    });
    const { openSingleMdFromDialog } = await import("./open-md-file");
    const result = await openSingleMdFromDialog();
    expect(result).toBe("/notes/a.md");
    expect(useSingleFile.getState().path).toBe("/notes/a.md");
    expect(useSingleFile.getState().content).toBe("hello");
  });
});
