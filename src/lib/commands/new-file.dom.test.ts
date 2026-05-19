// S-TST: new-file/new-folder commands broadcast a window CustomEvent.

import { describe, expect, it, vi } from "vitest";
import { newFileCommand, newFolderCommand } from "./new-file";

describe("newFileCommand", () => {
  it("dispatches the filetree new-file event", () => {
    const listener = vi.fn();
    window.addEventListener("markspread:filetree:new-file", listener);
    newFileCommand();
    window.removeEventListener("markspread:filetree:new-file", listener);
    expect(listener).toHaveBeenCalledTimes(1);
  });
});

describe("newFolderCommand", () => {
  it("dispatches the filetree new-folder event", () => {
    const listener = vi.fn();
    window.addEventListener("markspread:filetree:new-folder", listener);
    newFolderCommand();
    window.removeEventListener("markspread:filetree:new-folder", listener);
    expect(listener).toHaveBeenCalledTimes(1);
  });
});
