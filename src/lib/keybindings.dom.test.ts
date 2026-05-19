// keybinding bridge — keydown → command dispatch.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const runCommandMock = vi.fn();
const detachImeMock = vi.fn();
let imeComposing = false;

vi.mock("./commands/registry", () => ({
  commands: [
    { id: "cmd.new", defaultBinding: "Mod+N", run: () => {} },
    { id: "cmd.bold", defaultBinding: "Mod+Shift+B", run: () => {} },
    { id: "cmd.nobinding", run: () => {} },
  ],
  runCommand: (...args: unknown[]) => runCommandMock(...args),
}));
vi.mock("./keybindings/ime", () => ({
  attachImeGuard: () => detachImeMock,
  isComposing: () => imeComposing,
}));

beforeEach(() => {
  runCommandMock.mockReset();
  detachImeMock.mockReset();
  imeComposing = false;
  Object.defineProperty(navigator, "platform", {
    value: "MacIntel",
    configurable: true,
  });
});

afterEach(() => {
  vi.resetModules();
});

function press(init: KeyboardEventInit): void {
  window.dispatchEvent(new KeyboardEvent("keydown", { ...init, cancelable: true }));
}

describe("registerKeybindings", () => {
  it("dispatches a command on a matching chord (macOS uses Meta)", async () => {
    const { registerKeybindings } = await import("./keybindings");
    const dispose = registerKeybindings();
    press({ key: "n", metaKey: true });
    expect(runCommandMock).toHaveBeenCalledWith("cmd.new");
    dispose();
    expect(detachImeMock).toHaveBeenCalled();
  });

  it("requires shift when the binding includes it", async () => {
    const { registerKeybindings } = await import("./keybindings");
    const dispose = registerKeybindings();
    press({ key: "b", metaKey: true });
    expect(runCommandMock).not.toHaveBeenCalled();
    press({ key: "b", metaKey: true, shiftKey: true });
    expect(runCommandMock).toHaveBeenCalledWith("cmd.bold");
    dispose();
  });

  it("ignores keystrokes while the IME is composing", async () => {
    imeComposing = true;
    const { registerKeybindings } = await import("./keybindings");
    const dispose = registerKeybindings();
    press({ key: "n", metaKey: true });
    expect(runCommandMock).not.toHaveBeenCalled();
    dispose();
  });

  it("does not dispatch when the modifier is absent", async () => {
    const { registerKeybindings } = await import("./keybindings");
    const dispose = registerKeybindings();
    press({ key: "n" });
    expect(runCommandMock).not.toHaveBeenCalled();
    dispose();
  });

  it("uses Ctrl as the modifier on non-mac platforms", async () => {
    Object.defineProperty(navigator, "platform", {
      value: "Win32",
      configurable: true,
    });
    const { registerKeybindings } = await import("./keybindings");
    const dispose = registerKeybindings();
    press({ key: "n", ctrlKey: true });
    expect(runCommandMock).toHaveBeenCalledWith("cmd.new");
    dispose();
  });

  it("stops listening after the disposer runs", async () => {
    const { registerKeybindings } = await import("./keybindings");
    const dispose = registerKeybindings();
    dispose();
    press({ key: "n", metaKey: true });
    expect(runCommandMock).not.toHaveBeenCalled();
  });

  it("re-exports the keybindings index helpers", async () => {
    const mod = await import("./keybindings");
    expect(typeof mod.formatBinding).toBe("function");
    expect(typeof mod.resolveBinding).toBe("function");
    expect(typeof mod.normaliseBinding).toBe("function");
  });
});
