// S-WS-011: CLI path-argument routing.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useRecentWorkspaces } from "../store/recent-workspaces";
import { useSingleFile } from "../store/single-file";
import { useToasts } from "../store/toasts";
import { useWorkspace } from "../store/workspace";

const invokeMock = vi.fn();
vi.mock("@tauri-apps/api/core", () => ({
  invoke: (...args: unknown[]) => invokeMock(...args),
}));

beforeEach(() => {
  invokeMock.mockReset();
  useWorkspace.setState({ current: null });
  useSingleFile.setState({ path: null, content: "" });
  useToasts.setState({ toasts: [] });
  useRecentWorkspaces.setState({ recent: [] });
});

afterEach(() => {
  invokeMock.mockReset();
});

describe("routeCliPathArg", () => {
  it("toasts when fs_stat rejects", async () => {
    invokeMock.mockRejectedValueOnce(new Error("nope"));
    const { routeCliPathArg } = await import("./cli-route");
    await routeCliPathArg("/bad");
    const toasts = useToasts.getState().toasts;
    expect(toasts).toHaveLength(1);
    expect(toasts[0]?.message).toBe("cli.error.invalid_path");
  });

  it("opens a directory as workspace", async () => {
    invokeMock.mockResolvedValueOnce({ kind: "dir" }).mockResolvedValueOnce({ root: "/ws" });
    const { routeCliPathArg } = await import("./cli-route");
    await routeCliPathArg("/ws");
    expect(useWorkspace.getState().current).toBe("/ws");
    expect(useRecentWorkspaces.getState().recent[0]?.path).toBe("/ws");
  });

  it("toasts when workspace_scaffold fails", async () => {
    invokeMock
      .mockResolvedValueOnce({ kind: "dir" })
      .mockRejectedValueOnce(new Error("scaffold boom"));
    const { routeCliPathArg } = await import("./cli-route");
    await routeCliPathArg("/ws");
    expect(useWorkspace.getState().current).toBeNull();
    expect(useToasts.getState().toasts[0]?.message).toBe("cli.error.workspace_open_failed");
  });

  it("opens a file in single-file mode", async () => {
    invokeMock
      .mockResolvedValueOnce({ kind: "file" })
      .mockResolvedValueOnce({ content: "hello", encoding: "utf-8" });
    useWorkspace.setState({ current: "/old" });
    const { routeCliPathArg } = await import("./cli-route");
    await routeCliPathArg("/a.md");
    expect(useWorkspace.getState().current).toBeNull();
    expect(useSingleFile.getState().path).toBe("/a.md");
    expect(useSingleFile.getState().content).toBe("hello");
  });

  it("toasts when fs_read fails for a file", async () => {
    invokeMock
      .mockResolvedValueOnce({ kind: "file" })
      .mockRejectedValueOnce(new Error("read boom"));
    const { routeCliPathArg } = await import("./cli-route");
    await routeCliPathArg("/a.md");
    expect(useToasts.getState().toasts[0]?.message).toBe("cli.error.file_open_failed");
  });
});
