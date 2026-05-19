// S-FT-011: OS drag-and-drop routing.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useSingleFile } from "../store/single-file";
import { useToasts } from "../store/toasts";
import { useWorkspace } from "../store/workspace";

type DropPayload = {
  type: string;
  paths?: string[];
  position?: { x: number; y: number };
};
type DropHandler = (evt: { payload: DropPayload }) => Promise<void> | void;

const invokeMock = vi.fn();
const listenMock = vi.fn();
const askMock = vi.fn();
const onDragDropEventMock = vi.fn();

vi.mock("@tauri-apps/api/core", () => ({
  invoke: (...args: unknown[]) => invokeMock(...args),
}));
vi.mock("@tauri-apps/api/event", () => ({
  listen: (...args: unknown[]) => listenMock(...args),
}));
vi.mock("@tauri-apps/api/webview", () => ({
  getCurrentWebview: () => ({ onDragDropEvent: onDragDropEventMock }),
}));
vi.mock("@tauri-apps/plugin-dialog", () => ({
  ask: (...args: unknown[]) => askMock(...args),
}));

let dropHandler: DropHandler = () => {};

beforeEach(() => {
  invokeMock.mockReset();
  listenMock.mockReset();
  askMock.mockReset();
  onDragDropEventMock.mockReset();
  onDragDropEventMock.mockImplementation((cb: DropHandler) => {
    dropHandler = cb;
    return Promise.resolve(() => {});
  });
  listenMock.mockResolvedValue(() => {});
  useWorkspace.setState({ current: null });
  useSingleFile.setState({ path: null, content: "" });
  useToasts.setState({ toasts: [] });
  (window as { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__ = {};
});

afterEach(() => {
  // biome-ignore lint/performance/noDelete: test cleanup of injected global.
  delete (window as { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__;
});

async function flush(): Promise<void> {
  for (let i = 0; i < 5; i += 1) await Promise.resolve();
}

describe("registerDragDrop", () => {
  it("returns a no-op disposer outside the Tauri runtime", async () => {
    // biome-ignore lint/performance/noDelete: simulate non-Tauri env.
    delete (window as { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__;
    const { registerDragDrop } = await import("./dnd");
    const dispose = registerDragDrop();
    expect(() => dispose()).not.toThrow();
    expect(onDragDropEventMock).not.toHaveBeenCalled();
  });

  it("ignores non-drop events", async () => {
    const { registerDragDrop } = await import("./dnd");
    registerDragDrop();
    await flush();
    await dropHandler({ payload: { type: "enter" } });
    expect(invokeMock).not.toHaveBeenCalled();
  });

  it("ignores a drop with no paths", async () => {
    const { registerDragDrop } = await import("./dnd");
    registerDragDrop();
    await flush();
    await dropHandler({ payload: { type: "drop", paths: [] } });
    expect(invokeMock).not.toHaveBeenCalled();
  });

  it("routes a dropped file into single-file mode", async () => {
    invokeMock
      .mockResolvedValueOnce({ kind: "file" }) // fs_stat
      .mockResolvedValueOnce({ text: "body" }); // fs_read
    const { registerDragDrop } = await import("./dnd");
    registerDragDrop();
    await flush();
    await dropHandler({ payload: { type: "drop", paths: ["/a.md"] } });
    expect(useSingleFile.getState().path).toBe("/a.md");
    expect(useSingleFile.getState().content).toBe("body");
  });

  it("toasts when stat of the dropped path fails", async () => {
    invokeMock.mockRejectedValueOnce(new Error("stat boom"));
    const { registerDragDrop } = await import("./dnd");
    registerDragDrop();
    await flush();
    await dropHandler({ payload: { type: "drop", paths: ["/bad"] } });
    expect(useToasts.getState().toasts[0]?.message).toBe("dnd.error.stat_failed");
  });

  it("toasts when reading a dropped file fails", async () => {
    invokeMock
      .mockResolvedValueOnce({ kind: "file" })
      .mockRejectedValueOnce(new Error("read boom"));
    const { registerDragDrop } = await import("./dnd");
    registerDragDrop();
    await flush();
    await dropHandler({ payload: { type: "drop", paths: ["/a.md"] } });
    expect(useToasts.getState().toasts[0]?.message).toBe("dnd.error.file_open_failed");
  });

  it("opens a dropped folder as a workspace when none is open", async () => {
    invokeMock
      .mockResolvedValueOnce({ kind: "dir" }) // fs_stat
      .mockResolvedValueOnce({ already_existed: true }) // workspace_inspect
      .mockResolvedValueOnce({ root: "/ws", already_existed: true }); // scaffold
    const { registerDragDrop } = await import("./dnd");
    registerDragDrop();
    await flush();
    await dropHandler({ payload: { type: "drop", paths: ["/ws"] } });
    expect(useWorkspace.getState().current).toBe("/ws");
  });

  it("prompts before initialising a folder without a workspace", async () => {
    invokeMock
      .mockResolvedValueOnce({ kind: "dir" })
      .mockResolvedValueOnce({ already_existed: false });
    askMock.mockResolvedValueOnce(false);
    const { registerDragDrop } = await import("./dnd");
    registerDragDrop();
    await flush();
    await dropHandler({ payload: { type: "drop", paths: ["/ws"] } });
    expect(useWorkspace.getState().current).toBeNull();
  });

  it("toasts when workspace_inspect fails", async () => {
    invokeMock
      .mockResolvedValueOnce({ kind: "dir" })
      .mockRejectedValueOnce(new Error("inspect boom"));
    const { registerDragDrop } = await import("./dnd");
    registerDragDrop();
    await flush();
    await dropHandler({ payload: { type: "drop", paths: ["/ws"] } });
    expect(useToasts.getState().toasts[0]?.message).toBe("dnd.error.inspect_failed");
  });

  it("confirms before switching away from an open workspace", async () => {
    useWorkspace.setState({ current: "/old" });
    invokeMock
      .mockResolvedValueOnce({ kind: "dir" })
      .mockResolvedValueOnce({ already_existed: true });
    askMock.mockResolvedValueOnce(false);
    const { registerDragDrop } = await import("./dnd");
    registerDragDrop();
    await flush();
    await dropHandler({ payload: { type: "drop", paths: ["/ws"] } });
    expect(useWorkspace.getState().current).toBe("/old");
  });
});
