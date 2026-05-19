// S-TST: keybindings import/export command wrappers — toast surfacing.

import { beforeEach, describe, expect, it, vi } from "vitest";

const exportKeybindings = vi.fn();
const importKeybindings = vi.fn();
vi.mock("@/lib/keybindings/io", () => ({
  exportKeybindings: (...a: unknown[]) => exportKeybindings(...a),
  importKeybindings: (...a: unknown[]) => importKeybindings(...a),
}));

import { useToasts } from "@/store/toasts";
import { exportKeybindingsCommand, importKeybindingsCommand } from "./keybindings-io";

beforeEach(() => {
  exportKeybindings.mockReset();
  importKeybindings.mockReset();
  useToasts.setState({ toasts: [] });
});

describe("exportKeybindingsCommand", () => {
  it("pushes a success toast with the saved path", async () => {
    exportKeybindings.mockResolvedValueOnce("/tmp/kb.json");
    await exportKeybindingsCommand();
    const toasts = useToasts.getState().toasts;
    expect(toasts[0]?.kind).toBe("success");
    expect(toasts[0]?.details).toBe("/tmp/kb.json");
  });

  it("stays quiet when the user cancels the save dialog", async () => {
    exportKeybindings.mockResolvedValueOnce(null);
    await exportKeybindingsCommand();
    expect(useToasts.getState().toasts).toHaveLength(0);
  });

  it("pushes an error toast when export throws", async () => {
    exportKeybindings.mockRejectedValueOnce(new Error("disk full"));
    await exportKeybindingsCommand();
    const toasts = useToasts.getState().toasts;
    expect(toasts[0]?.kind).toBe("error");
    expect(toasts[0]?.details).toBe("disk full");
  });

  it("stringifies non-Error rejections", async () => {
    exportKeybindings.mockRejectedValueOnce("weird");
    await exportKeybindingsCommand();
    expect(useToasts.getState().toasts[0]?.details).toBe("weird");
  });
});

describe("importKeybindingsCommand", () => {
  it("pushes a success toast in merge mode with no conflicts", async () => {
    importKeybindings.mockResolvedValueOnce({ applied: 3, skipped: 0, conflicts: [] });
    await importKeybindingsCommand();
    expect(importKeybindings).toHaveBeenCalledWith("merge");
    const toasts = useToasts.getState().toasts;
    expect(toasts[0]?.kind).toBe("success");
    expect(toasts[0]?.details).toContain("3 applied");
  });

  it("uses replace mode when asked", async () => {
    importKeybindings.mockResolvedValueOnce({ applied: 1, skipped: 0, conflicts: [] });
    await importKeybindingsCommand("replace");
    expect(importKeybindings).toHaveBeenCalledWith("replace");
    expect(useToasts.getState().toasts[0]?.details).toContain("(replace)");
  });

  it("warns when there are conflicts", async () => {
    importKeybindings.mockResolvedValueOnce({
      applied: 2,
      skipped: 0,
      conflicts: [{ commandId: "c", existing: "Mod+A", incoming: "Mod+B" }],
    });
    await importKeybindingsCommand();
    const toasts = useToasts.getState().toasts;
    expect(toasts[0]?.kind).toBe("warning");
    expect(toasts[0]?.details).toContain("1 replaced existing override");
  });

  it("stays quiet when the user cancels the open dialog", async () => {
    importKeybindings.mockResolvedValueOnce(null);
    await importKeybindingsCommand();
    expect(useToasts.getState().toasts).toHaveLength(0);
  });

  it("pushes an error toast when import throws", async () => {
    importKeybindings.mockRejectedValueOnce(new Error("bad json"));
    await importKeybindingsCommand();
    const toasts = useToasts.getState().toasts;
    expect(toasts[0]?.kind).toBe("error");
    expect(toasts[0]?.details).toBe("bad json");
  });

  it("stringifies non-Error import rejections", async () => {
    importKeybindings.mockRejectedValueOnce(123);
    await importKeybindingsCommand();
    expect(useToasts.getState().toasts[0]?.details).toBe("123");
  });
});
