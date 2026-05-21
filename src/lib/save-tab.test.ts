// S-FT-018: tab save path — orphaned-recreate flow + write failure handling.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useTabs } from "../store/tabs";
import { useToasts } from "../store/toasts";

const invokeMock = vi.fn();
const askMock = vi.fn();
vi.mock("@tauri-apps/api/core", () => ({
  invoke: (...args: unknown[]) => invokeMock(...args),
}));
vi.mock("@tauri-apps/plugin-dialog", () => ({
  ask: (...args: unknown[]) => askMock(...args),
}));

function seedTab(path: string, orphaned: boolean): void {
  useTabs.setState({
    tabs: [
      {
        path,
        position: { line: 0, column: 0, scrollTop: 0 },
        dirty: true,
        preview: false,
        pinned: false,
        orphaned,
      },
    ],
    activePath: path,
  });
}

beforeEach(() => {
  invokeMock.mockReset();
  askMock.mockReset();
  useTabs.setState({ tabs: [], activePath: null });
  useToasts.setState({ toasts: [] });
});

afterEach(() => {
  invokeMock.mockReset();
  askMock.mockReset();
});

describe("saveTab", () => {
  it("writes a non-orphaned tab and clears dirty state", async () => {
    seedTab("/ws/a.md", false);
    invokeMock.mockResolvedValueOnce(undefined);
    const { saveTab } = await import("./save-tab");
    const ok = await saveTab({ workspace: "/ws", path: "/ws/a.md", content: "x" });
    expect(ok).toBe(true);
    expect(invokeMock).toHaveBeenCalledWith("fs_write", {
      workspace: "/ws",
      path: "/ws/a.md",
      content: "x",
    });
    expect(useTabs.getState().tabs[0]?.dirty).toBe(false);
    expect(useTabs.getState().tabs[0]?.orphaned).toBe(false);
  });

  it("returns false when the user cancels recreation of an orphaned file", async () => {
    seedTab("/ws/a.md", true);
    askMock.mockResolvedValueOnce(false);
    const { saveTab } = await import("./save-tab");
    const ok = await saveTab({ workspace: "/ws", path: "/ws/a.md", content: "x" });
    expect(ok).toBe(false);
    expect(invokeMock).not.toHaveBeenCalled();
  });

  it("recreates an orphaned file then writes", async () => {
    seedTab("/ws/a.md", true);
    askMock.mockResolvedValueOnce(true);
    invokeMock.mockResolvedValueOnce(undefined).mockResolvedValueOnce(undefined);
    const { saveTab } = await import("./save-tab");
    const ok = await saveTab({ workspace: "/ws", path: "/ws/a.md", content: "x" });
    expect(ok).toBe(true);
    expect(invokeMock).toHaveBeenNthCalledWith(1, "fs_create_file", {
      workspace: "/ws",
      path: "/ws/a.md",
    });
    expect(invokeMock).toHaveBeenNthCalledWith(2, "fs_write", expect.any(Object));
  });

  it("tolerates an 'already exists' create error and proceeds to write", async () => {
    seedTab("/ws/a.md", true);
    askMock.mockResolvedValueOnce(true);
    invokeMock
      .mockRejectedValueOnce(new Error("file already exists"))
      .mockResolvedValueOnce(undefined);
    const { saveTab } = await import("./save-tab");
    const ok = await saveTab({ workspace: "/ws", path: "/ws/a.md", content: "x" });
    expect(ok).toBe(true);
  });

  it("toasts and aborts when recreate fails for a non-exists reason", async () => {
    seedTab("/ws/a.md", true);
    askMock.mockResolvedValueOnce(true);
    invokeMock.mockRejectedValueOnce(new Error("permission denied"));
    const { saveTab } = await import("./save-tab");
    const ok = await saveTab({ workspace: "/ws", path: "/ws/a.md", content: "x" });
    expect(ok).toBe(false);
    expect(useToasts.getState().toasts[0]?.message).toBe("save.recreate_failed");
  });

  it("toasts and returns false when fs_write fails", async () => {
    seedTab("/ws/a.md", false);
    invokeMock.mockRejectedValueOnce(new Error("disk full"));
    const { saveTab } = await import("./save-tab");
    const ok = await saveTab({ workspace: "/ws", path: "/ws/a.md", content: "x" });
    expect(ok).toBe(false);
    expect(useToasts.getState().toasts[0]?.message).toBe("save.failed");
  });

  it("treats an untracked path as non-orphaned", async () => {
    invokeMock.mockResolvedValueOnce(undefined);
    const { saveTab } = await import("./save-tab");
    const ok = await saveTab({ workspace: "/ws", path: "/ws/unknown.md", content: "x" });
    expect(ok).toBe(true);
  });

  it("stringifies a bare-string recreate rejection (no .message field)", async () => {
    seedTab("/ws/a.md", true);
    askMock.mockResolvedValueOnce(true);
    invokeMock.mockRejectedValueOnce("permission denied");
    const { saveTab } = await import("./save-tab");
    const ok = await saveTab({ workspace: "/ws", path: "/ws/a.md", content: "x" });
    expect(ok).toBe(false);
    expect(useToasts.getState().toasts[0]?.details).toBe("permission denied");
  });

  it("stringifies a bare-string write rejection (no .message field)", async () => {
    seedTab("/ws/a.md", false);
    invokeMock.mockRejectedValueOnce("disk full");
    const { saveTab } = await import("./save-tab");
    const ok = await saveTab({ workspace: "/ws", path: "/ws/a.md", content: "x" });
    expect(ok).toBe(false);
    expect(useToasts.getState().toasts[0]?.details).toBe("disk full");
  });
});
