import { act, cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

type Handler = (evt: { payload: unknown }) => void;
const handlers = new Map<string, Handler>();

vi.mock("@tauri-apps/api/event", () => ({
  listen: (name: string, cb: Handler) => {
    handlers.set(name, cb);
    return Promise.resolve(() => handlers.delete(name));
  },
}));

import { IndexProgressBar } from "./IndexProgressBar";

async function flush() {
  await act(async () => {
    await Promise.resolve();
  });
}

afterEach(cleanup);

describe("IndexProgressBar", () => {
  it("renders nothing when idle", async () => {
    const { container } = render(<IndexProgressBar />);
    await flush();
    expect(container.firstChild).toBeNull();
  });

  it("shows progress on a rebuilding event", async () => {
    render(<IndexProgressBar />);
    await flush();
    act(() => {
      handlers.get("fs:index:progress")?.({
        payload: { workspace: "/ws", files_seen: 12, bytes_seen: 4096, state: "rebuilding" },
      });
    });
    expect(screen.getByText(/12개 파일/)).toBeTruthy();
  });

  it("hides again on the done event", async () => {
    const { container } = render(<IndexProgressBar />);
    await flush();
    act(() => {
      handlers.get("fs:index:progress")?.({
        payload: { workspace: "/ws", files_seen: 1, bytes_seen: 1, state: "rebuilding" },
      });
    });
    act(() => {
      handlers.get("fs:index:done")?.({ payload: {} });
    });
    expect(container.firstChild).toBeNull();
  });
});
