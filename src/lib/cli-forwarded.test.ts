// cli://forwarded event listener wiring.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

type EventHandler = (evt: { payload: { path_arg: string | null } }) => void;

const listenMock = vi.fn();
const unlistenMock = vi.fn();
const routeMock = vi.fn();

vi.mock("@tauri-apps/api/event", () => ({
  listen: (...args: unknown[]) => listenMock(...args),
}));
vi.mock("./cli-route", () => ({
  routeCliPathArg: (...args: unknown[]) => routeMock(...args),
}));

beforeEach(() => {
  listenMock.mockReset();
  unlistenMock.mockReset();
  routeMock.mockReset();
});

afterEach(() => {
  vi.resetModules();
});

async function flush(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
}

describe("registerCliForwardedListener", () => {
  it("subscribes to cli://forwarded and routes a non-empty path", async () => {
    let handler: EventHandler = () => {};
    listenMock.mockImplementation((_event: string, cb: EventHandler) => {
      handler = cb;
      return Promise.resolve(unlistenMock);
    });
    const { registerCliForwardedListener } = await import("./cli-forwarded");
    const dispose = registerCliForwardedListener();
    await flush();
    expect(listenMock).toHaveBeenCalledWith("cli://forwarded", expect.any(Function));

    handler({ payload: { path_arg: "/some/path" } });
    expect(routeMock).toHaveBeenCalledWith("/some/path");

    dispose();
    expect(unlistenMock).toHaveBeenCalled();
  });

  it("ignores null or empty path payloads", async () => {
    let handler: EventHandler = () => {};
    listenMock.mockImplementation((_event: string, cb: EventHandler) => {
      handler = cb;
      return Promise.resolve(unlistenMock);
    });
    const { registerCliForwardedListener } = await import("./cli-forwarded");
    registerCliForwardedListener();
    await flush();
    handler({ payload: { path_arg: null } });
    handler({ payload: { path_arg: "" } });
    expect(routeMock).not.toHaveBeenCalled();
  });

  it("swallows a rejected listen() and returns a safe disposer", async () => {
    listenMock.mockRejectedValueOnce(new Error("no runtime"));
    const { registerCliForwardedListener } = await import("./cli-forwarded");
    const dispose = registerCliForwardedListener();
    await flush();
    expect(() => dispose()).not.toThrow();
    expect(unlistenMock).not.toHaveBeenCalled();
  });
});
