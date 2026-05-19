// S-TST: new-window command — spawns a window via IPC, toasts on failure.

import { beforeEach, describe, expect, it, vi } from "vitest";

const invoke = vi.fn();
vi.mock("@tauri-apps/api/core", () => ({
  invoke: (...args: unknown[]) => invoke(...args),
}));

import { useToasts } from "../../store/toasts";
import { newWindowCommand } from "./new-window";

beforeEach(() => {
  invoke.mockReset();
  useToasts.setState({ toasts: [] });
});

describe("newWindowCommand", () => {
  it("returns the new window label on success", async () => {
    invoke.mockResolvedValueOnce({ label: "win-2" });
    const label = await newWindowCommand();
    expect(label).toBe("win-2");
    expect(invoke).toHaveBeenCalledWith("window_new");
    expect(useToasts.getState().toasts).toHaveLength(0);
  });

  it("returns null and pushes an error toast on failure", async () => {
    invoke.mockRejectedValueOnce(new Error("denied"));
    const label = await newWindowCommand();
    expect(label).toBeNull();
    const toasts = useToasts.getState().toasts;
    expect(toasts).toHaveLength(1);
    expect(toasts[0]?.kind).toBe("error");
    expect(toasts[0]?.message).toBe("window.new.failed");
  });
});
