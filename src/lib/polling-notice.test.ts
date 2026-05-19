// S-WS-025: network-drive polling-fallback notice — once per workspace.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useToasts } from "../store/toasts";

type EventHandler = (evt: { payload: { workspace: string; reason: string } }) => void;

const listenMock = vi.fn();
const unlistenMock = vi.fn();

vi.mock("@tauri-apps/api/event", () => ({
  listen: (...args: unknown[]) => listenMock(...args),
}));

beforeEach(() => {
  listenMock.mockReset();
  unlistenMock.mockReset();
  useToasts.setState({ toasts: [] });
});

afterEach(() => {});

async function flush(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
}

describe("registerPollingNoticeListener", () => {
  it("toasts once per workspace and dedupes repeats", async () => {
    let handler: EventHandler = () => {};
    listenMock.mockImplementation((_e: string, cb: EventHandler) => {
      handler = cb;
      return Promise.resolve(unlistenMock);
    });
    const { registerPollingNoticeListener } = await import("./polling-notice");
    const dispose = registerPollingNoticeListener();
    await flush();
    expect(listenMock).toHaveBeenCalledWith("fs:polling_fallback", expect.any(Function));

    handler({ payload: { workspace: "/ws", reason: "smb" } });
    handler({ payload: { workspace: "/ws", reason: "smb" } });
    const toasts = useToasts.getState().toasts;
    expect(toasts).toHaveLength(1);
    expect(toasts[0]?.message).toBe("watcher.polling_fallback");
    expect(toasts[0]?.details).toBe("smb");

    handler({ payload: { workspace: "/other", reason: "nfs" } });
    expect(useToasts.getState().toasts).toHaveLength(2);

    dispose();
    expect(unlistenMock).toHaveBeenCalled();
  });

  it("returns a safe disposer when listen rejects", async () => {
    listenMock.mockRejectedValueOnce(new Error("no runtime"));
    const { registerPollingNoticeListener } = await import("./polling-notice");
    const dispose = registerPollingNoticeListener();
    await flush();
    expect(() => dispose()).not.toThrow();
  });
});
