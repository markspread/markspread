// S-WS-020/023: unmount watcher arming + disconnect handling.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useTabs } from "../store/tabs";
import { useToasts } from "../store/toasts";
import { useWorkspace } from "../store/workspace";

type EventHandler = (evt: { payload: { workspace: string } }) => Promise<void> | void;

const invokeMock = vi.fn();
const listenMock = vi.fn();
const unlistenMock = vi.fn();
const askMock = vi.fn();
const locateMock = vi.fn();

vi.mock("@tauri-apps/api/core", () => ({
  invoke: (...args: unknown[]) => invokeMock(...args),
}));
vi.mock("@tauri-apps/api/event", () => ({
  listen: (...args: unknown[]) => listenMock(...args),
}));
vi.mock("@tauri-apps/plugin-dialog", () => ({
  ask: (...args: unknown[]) => askMock(...args),
}));
vi.mock("./commands/locate-workspace", () => ({
  locateWorkspaceCommand: (...args: unknown[]) => locateMock(...args),
}));

function tab(path: string, dirty: boolean) {
  return {
    path,
    position: { line: 0, column: 0, scrollTop: 0 },
    dirty,
  };
}

beforeEach(() => {
  invokeMock.mockReset();
  listenMock.mockReset();
  unlistenMock.mockReset();
  askMock.mockReset();
  locateMock.mockReset();
  useWorkspace.setState({ current: null });
  useTabs.setState({ tabs: [], activePath: null });
  useToasts.setState({ toasts: [] });
});

afterEach(() => {});

async function flush(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
}

describe("maybeStartUnmountWatch", () => {
  it("skips internal drives", async () => {
    invokeMock.mockResolvedValueOnce({ kind: "internal" });
    const { maybeStartUnmountWatch } = await import("./unmount");
    await maybeStartUnmountWatch("/ws");
    expect(invokeMock).toHaveBeenCalledTimes(1);
    expect(invokeMock).not.toHaveBeenCalledWith("unmount_watch_start", expect.anything());
  });

  it("arms the watcher on an external drive", async () => {
    invokeMock.mockResolvedValueOnce({ kind: "external" }).mockResolvedValueOnce(undefined);
    const { maybeStartUnmountWatch } = await import("./unmount");
    await maybeStartUnmountWatch("/ws-ext");
    expect(invokeMock).toHaveBeenCalledWith("unmount_watch_start", { workspace: "/ws-ext" });
  });

  it("does not double-arm an already-watched workspace", async () => {
    invokeMock.mockResolvedValueOnce({ kind: "network" }).mockResolvedValueOnce(undefined);
    const { maybeStartUnmountWatch } = await import("./unmount");
    await maybeStartUnmountWatch("/ws-dbl");
    await maybeStartUnmountWatch("/ws-dbl");
    expect(invokeMock).toHaveBeenCalledTimes(2);
  });

  it("treats a drive_classify rejection as unknown and skips", async () => {
    invokeMock.mockRejectedValueOnce(new Error("no runtime"));
    const { maybeStartUnmountWatch } = await import("./unmount");
    await maybeStartUnmountWatch("/ws-rej");
    expect(invokeMock).toHaveBeenCalledTimes(1);
  });
});

describe("stopUnmountWatch", () => {
  it("is a no-op when the workspace is not watched", async () => {
    const { stopUnmountWatch } = await import("./unmount");
    await stopUnmountWatch("/ws-never");
    expect(invokeMock).not.toHaveBeenCalled();
  });

  it("stops a watched workspace", async () => {
    invokeMock
      .mockResolvedValueOnce({ kind: "external" })
      .mockResolvedValueOnce(undefined)
      .mockResolvedValueOnce(undefined);
    const mod = await import("./unmount");
    await mod.maybeStartUnmountWatch("/ws-stop");
    await mod.stopUnmountWatch("/ws-stop");
    expect(invokeMock).toHaveBeenCalledWith("unmount_watch_stop", { workspace: "/ws-stop" });
  });
});

describe("registerUnmountListener", () => {
  it("ignores a disconnect for a different workspace", async () => {
    let handler: EventHandler = () => {};
    listenMock.mockImplementation((_e: string, cb: EventHandler) => {
      handler = cb;
      return Promise.resolve(unlistenMock);
    });
    useWorkspace.setState({ current: "/ws-a" });
    const { registerUnmountListener } = await import("./unmount");
    registerUnmountListener();
    await flush();
    await handler({ payload: { workspace: "/ws-b" } });
    expect(useToasts.getState().toasts).toHaveLength(0);
  });

  it("dumps dirty tabs and closes the workspace on disconnect", async () => {
    let handler: EventHandler = () => {};
    listenMock.mockImplementation((_e: string, cb: EventHandler) => {
      handler = cb;
      return Promise.resolve(unlistenMock);
    });
    invokeMock.mockResolvedValue(undefined);
    askMock.mockResolvedValueOnce(false);
    useWorkspace.setState({ current: "/ws" });
    useTabs.setState({
      tabs: [tab("/ws/a.md", true), tab("/ws/b.md", false)],
      activePath: "/ws/a.md",
    });
    const { registerUnmountListener } = await import("./unmount");
    registerUnmountListener();
    await flush();
    await handler({ payload: { workspace: "/ws" } });
    expect(invokeMock).toHaveBeenCalledWith(
      "unmount_dump_orphan",
      expect.objectContaining({ relativePath: "a.md" }),
    );
    expect(useToasts.getState().toasts[0]?.message).toBe("workspace.disconnected");
    expect(useWorkspace.getState().current).toBeNull();
  });

  it("keeps the workspace when the user relocates it", async () => {
    let handler: EventHandler = () => {};
    listenMock.mockImplementation((_e: string, cb: EventHandler) => {
      handler = cb;
      return Promise.resolve(unlistenMock);
    });
    invokeMock.mockResolvedValue(undefined);
    askMock.mockResolvedValueOnce(true);
    locateMock.mockResolvedValueOnce(true);
    useWorkspace.setState({ current: "/ws" });
    useTabs.setState({ tabs: [], activePath: null });
    const { registerUnmountListener } = await import("./unmount");
    registerUnmountListener();
    await flush();
    await handler({ payload: { workspace: "/ws" } });
    expect(locateMock).toHaveBeenCalledWith("/ws");
    expect(useWorkspace.getState().current).toBe("/ws");
  });

  it("returns a safe disposer when listen rejects", async () => {
    listenMock.mockRejectedValueOnce(new Error("no runtime"));
    const { registerUnmountListener } = await import("./unmount");
    const dispose = registerUnmountListener();
    await flush();
    expect(() => dispose()).not.toThrow();
  });

  it("emits a generic toast detail when no dirty buffers were dumped", async () => {
    let handler: EventHandler = () => {};
    listenMock.mockImplementation((_e: string, cb: EventHandler) => {
      handler = cb;
      return Promise.resolve(unlistenMock);
    });
    invokeMock.mockResolvedValue(undefined);
    askMock.mockResolvedValueOnce(false);
    // Tab path doesn't start with the workspace prefix — exercises the false
    // branch of the startsWith ternary, and the dump invoke rejects so the
    // dumped count stays at 0.
    invokeMock.mockImplementation(async (cmd: string) => {
      if (cmd === "unmount_dump_orphan") throw new Error("disk full");
      return undefined;
    });
    useWorkspace.setState({ current: "/ws" });
    useTabs.setState({
      tabs: [tab("/elsewhere/file.md", true)],
      activePath: "/elsewhere/file.md",
    });
    const { registerUnmountListener } = await import("./unmount");
    registerUnmountListener();
    await flush();
    await handler({ payload: { workspace: "/ws" } });
    expect(useToasts.getState().toasts[0]?.details).toBe("/ws");
  });

  it("dispose unsubscribes the underlying Tauri listener once attached", async () => {
    listenMock.mockResolvedValueOnce(unlistenMock);
    const { registerUnmountListener } = await import("./unmount");
    const dispose = registerUnmountListener();
    await flush();
    dispose();
    expect(unlistenMock).toHaveBeenCalled();
  });

  it("dispose is a no-op when the listener never resolved", async () => {
    listenMock.mockReturnValue(new Promise(() => {}));
    const { registerUnmountListener } = await import("./unmount");
    const dispose = registerUnmountListener();
    expect(() => dispose()).not.toThrow();
  });

  it("treats unmount_watch_start rejections as a soft failure", async () => {
    invokeMock
      .mockResolvedValueOnce({ kind: "external" })
      .mockRejectedValueOnce(new Error("start boom"));
    const { maybeStartUnmountWatch } = await import("./unmount");
    await expect(maybeStartUnmountWatch("/ws-start-fail")).resolves.toBeUndefined();
  });

  it("treats unmount_watch_stop rejections as a soft failure", async () => {
    invokeMock
      .mockResolvedValueOnce({ kind: "external" })
      .mockResolvedValueOnce(undefined)
      .mockRejectedValueOnce(new Error("stop boom"));
    const mod = await import("./unmount");
    await mod.maybeStartUnmountWatch("/ws-stop-fail");
    await expect(mod.stopUnmountWatch("/ws-stop-fail")).resolves.toBeUndefined();
  });
});
