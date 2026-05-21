// S-KB-001/006/012: keybinding store + preset registry.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

beforeEach(() => {
  Object.defineProperty(navigator, "platform", { value: "MacIntel", configurable: true });
});
afterEach(() => {
  vi.resetModules();
});

async function freshModule() {
  vi.resetModules();
  return import("../index");
}

function makeEvent(init: KeyboardEventInit): KeyboardEvent {
  return new KeyboardEvent("keydown", init);
}

describe("preset management", () => {
  it("starts on the vscode preset", async () => {
    const m = await freshModule();
    expect(m.getPreset()).toBe("vscode");
  });

  it("switchPreset accepts a known preset name", async () => {
    const m = await freshModule();
    expect(m.switchPreset("none")).toBe(true);
    expect(m.getPreset()).toBe("none");
  });

  it("switchPreset rejects an unknown preset", async () => {
    const m = await freshModule();
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    expect(m.switchPreset("does-not-exist" as never)).toBe(false);
    expect(warn).toHaveBeenCalled();
    expect(m.getPreset()).toBe("vscode");
    warn.mockRestore();
  });

  it("setPreset directly swaps the active entries", async () => {
    const m = await freshModule();
    const custom = [{ commandId: "cmd.test", binding: "Mod+T", source: "preset" as const }];
    m.setPreset("none", custom);
    expect(m.getPreset()).toBe("none");
    expect(m.listActiveBindings()).toEqual(custom);
  });
});

describe("user overrides", () => {
  it("setUserOverride wins over the preset binding", async () => {
    const m = await freshModule();
    m.setUserOverride("cmd.test", "Mod+Y");
    const found = m
      .listActiveBindings()
      .find((b) => b.commandId === "cmd.test" && b.source === "user");
    expect(found?.binding).toBe("Mod+Y");
  });

  it("clearUserOverride drops the override", async () => {
    const m = await freshModule();
    m.setUserOverride("cmd.test", "Mod+Y");
    m.clearUserOverride("cmd.test");
    const found = m
      .listActiveBindings()
      .find((b) => b.commandId === "cmd.test" && b.source === "user");
    expect(found).toBeUndefined();
  });
});

describe("plugin keybindings", () => {
  it("registers and lists a plugin binding", async () => {
    const m = await freshModule();
    m.registerPluginKeybindings("p1", [{ commandId: "p1.action", binding: "Mod+Alt+P" }]);
    const found = m.listActiveBindings().find((b) => b.commandId === "p1.action");
    expect(found?.source).toBe("plugin");
    expect(found?.pluginId).toBe("p1");
  });

  it("re-registering replaces the prior set rather than accumulating", async () => {
    const m = await freshModule();
    m.registerPluginKeybindings("p1", [{ commandId: "p1.a", binding: "Mod+1" }]);
    m.registerPluginKeybindings("p1", [{ commandId: "p1.b", binding: "Mod+2" }]);
    const ids = m.listActiveBindings().map((b) => b.commandId);
    expect(ids).not.toContain("p1.a");
    expect(ids).toContain("p1.b");
  });

  it("unregisterPluginKeybindings drops just that plugin's entries", async () => {
    const m = await freshModule();
    m.registerPluginKeybindings("p1", [{ commandId: "p1.a", binding: "Mod+1" }]);
    m.registerPluginKeybindings("p2", [{ commandId: "p2.a", binding: "Mod+2" }]);
    m.unregisterPluginKeybindings("p1");
    const ids = m.listActiveBindings().map((b) => b.commandId);
    expect(ids).not.toContain("p1.a");
    expect(ids).toContain("p2.a");
  });

  it("user overrides survive plugin re-registration", async () => {
    const m = await freshModule();
    m.registerPluginKeybindings("p1", [{ commandId: "p1.a", binding: "Mod+1" }]);
    m.setUserOverride("p1.a", "Mod+Shift+1");
    m.unregisterPluginKeybindings("p1");
    m.registerPluginKeybindings("p1", [{ commandId: "p1.a", binding: "Mod+1" }]);
    const found = m.listActiveBindings().find((b) => b.commandId === "p1.a" && b.source === "user");
    expect(found?.binding).toBe("Mod+Shift+1");
  });
});

describe("normaliseBinding", () => {
  it("sorts modifiers into the canonical order", async () => {
    const m = await freshModule();
    expect(m.normaliseBinding("Shift+Alt+Ctrl+Mod+S")).toBe("Mod+Ctrl+Alt+Shift+S");
  });

  it("handles a chord", async () => {
    const m = await freshModule();
    expect(m.normaliseBinding("Mod+K Mod+S")).toBe("Mod+K Mod+S");
  });

  it("normalises bare modifiers (no key) to just the mods", async () => {
    const m = await freshModule();
    expect(m.normaliseBinding("Alt+Shift")).toBe("Alt+Shift");
  });
});

describe("bindingFromEvent", () => {
  it("emits Mod for Cmd on macOS", async () => {
    const m = await freshModule();
    const b = m.bindingFromEvent(makeEvent({ key: "s", code: "KeyS", metaKey: true }));
    expect(b).toBe("Mod+S");
  });

  it("emits Mod for Ctrl on Windows", async () => {
    Object.defineProperty(navigator, "platform", { value: "Win32", configurable: true });
    const m = await freshModule();
    const b = m.bindingFromEvent(makeEvent({ key: "s", code: "KeyS", ctrlKey: true }));
    expect(b).toBe("Mod+S");
  });

  it("emits Meta separately on non-mac platforms", async () => {
    Object.defineProperty(navigator, "platform", { value: "Win32", configurable: true });
    const m = await freshModule();
    const b = m.bindingFromEvent(makeEvent({ key: "s", code: "KeyS", metaKey: true }));
    expect(b).toContain("Meta");
  });

  it("emits Ctrl as a distinct modifier on macOS", async () => {
    const m = await freshModule();
    const b = m.bindingFromEvent(
      makeEvent({ key: "s", code: "KeyS", ctrlKey: true, metaKey: true }),
    );
    expect(b).toContain("Ctrl");
    expect(b).toContain("Mod");
  });

  it("includes Alt and Shift", async () => {
    const m = await freshModule();
    const b = m.bindingFromEvent(
      makeEvent({ key: "/", code: "Slash", altKey: true, shiftKey: true, metaKey: true }),
    );
    expect(b).toBe("Mod+Alt+Shift+/");
  });

  it("maps Digit and special codes", async () => {
    const m = await freshModule();
    expect(m.bindingFromEvent(makeEvent({ key: "1", code: "Digit1", metaKey: true }))).toBe(
      "Mod+1",
    );
    expect(m.bindingFromEvent(makeEvent({ key: " ", code: "Space", metaKey: true }))).toBe(
      "Mod+Space",
    );
    expect(m.bindingFromEvent(makeEvent({ key: "Enter", code: "Enter", metaKey: true }))).toBe(
      "Mod+Enter",
    );
    expect(m.bindingFromEvent(makeEvent({ key: "ArrowUp", code: "ArrowUp", metaKey: true }))).toBe(
      "Mod+ArrowUp",
    );
    expect(m.bindingFromEvent(makeEvent({ key: "Escape", code: "Escape" }))).toBe("Escape");
  });

  it("returns empty for an empty key code", async () => {
    const m = await freshModule();
    expect(m.bindingFromEvent(makeEvent({ key: "", code: "" }))).toBe("");
  });

  it("falls back to event.key for unknown codes", async () => {
    const m = await freshModule();
    expect(m.bindingFromEvent(makeEvent({ key: "Pause", code: "Pause" }))).toBe("Pause");
  });

  it("recognises F-keys", async () => {
    const m = await freshModule();
    expect(m.bindingFromEvent(makeEvent({ key: "F5", code: "F5" }))).toBe("F5");
  });

  it("maps the common punctuation codes", async () => {
    const m = await freshModule();
    expect(m.bindingFromEvent(makeEvent({ key: "\\", code: "Backslash" }))).toBe("\\");
    expect(m.bindingFromEvent(makeEvent({ key: "`", code: "Backquote" }))).toBe("`");
    expect(m.bindingFromEvent(makeEvent({ key: "-", code: "Minus" }))).toBe("-");
    expect(m.bindingFromEvent(makeEvent({ key: "=", code: "Equal" }))).toBe("=");
    expect(m.bindingFromEvent(makeEvent({ key: ",", code: "Comma" }))).toBe(",");
    expect(m.bindingFromEvent(makeEvent({ key: ".", code: "Period" }))).toBe(".");
    expect(m.bindingFromEvent(makeEvent({ key: ";", code: "Semicolon" }))).toBe(";");
    expect(m.bindingFromEvent(makeEvent({ key: "'", code: "Quote" }))).toBe("'");
    expect(m.bindingFromEvent(makeEvent({ key: "[", code: "BracketLeft" }))).toBe("[");
    expect(m.bindingFromEvent(makeEvent({ key: "]", code: "BracketRight" }))).toBe("]");
    expect(m.bindingFromEvent(makeEvent({ key: "Tab", code: "Tab" }))).toBe("Tab");
    expect(m.bindingFromEvent(makeEvent({ key: "Backspace", code: "Backspace" }))).toBe(
      "Backspace",
    );
    expect(m.bindingFromEvent(makeEvent({ key: "Delete", code: "Delete" }))).toBe("Delete");
    expect(m.bindingFromEvent(makeEvent({ key: "ArrowDown", code: "ArrowDown" }))).toBe(
      "ArrowDown",
    );
    expect(m.bindingFromEvent(makeEvent({ key: "ArrowLeft", code: "ArrowLeft" }))).toBe(
      "ArrowLeft",
    );
    expect(m.bindingFromEvent(makeEvent({ key: "ArrowRight", code: "ArrowRight" }))).toBe(
      "ArrowRight",
    );
  });
});

describe("resolveBinding", () => {
  it("resolves a single-step binding to its command id", async () => {
    const m = await freshModule();
    m.setPreset("none", [{ commandId: "cmd.save", binding: "Mod+S", source: "preset" }]);
    const id = m.resolveBinding(makeEvent({ key: "s", code: "KeyS", metaKey: true }));
    expect(id).toBe("cmd.save");
  });

  it("resolves a chord binding when a prefix is provided", async () => {
    const m = await freshModule();
    m.setPreset("none", [{ commandId: "cmd.chord", binding: "Mod+K Mod+S", source: "preset" }]);
    const id = m.resolveBinding(makeEvent({ key: "s", code: "KeyS", metaKey: true }), "Mod+K");
    expect(id).toBe("cmd.chord");
  });

  it("returns null when no binding matches", async () => {
    const m = await freshModule();
    m.setPreset("none", []);
    const id = m.resolveBinding(makeEvent({ key: "z", code: "KeyZ", metaKey: true }));
    expect(id).toBeNull();
  });

  it("returns null for an unbindable event", async () => {
    const m = await freshModule();
    const id = m.resolveBinding(makeEvent({ key: "", code: "" }));
    expect(id).toBeNull();
  });
});

describe("formatBinding", () => {
  it("returns an empty string for an empty binding", async () => {
    const m = await freshModule();
    expect(m.formatBinding("")).toBe("");
  });

  it("renders mac glyphs on macOS", async () => {
    const m = await freshModule();
    const out = m.formatBinding("Mod+Shift+P");
    expect(out).toContain("⌘");
    expect(out).toContain("⇧");
  });

  it("renders Windows modifiers on non-mac", async () => {
    Object.defineProperty(navigator, "platform", { value: "Win32", configurable: true });
    const m = await freshModule();
    const out = m.formatBinding("Mod+Shift+P");
    expect(out).toContain("Ctrl");
    expect(out).toContain("Shift");
  });

  it("maps the arrow and modifier glyphs on mac", async () => {
    const m = await freshModule();
    const out = m.formatBinding("Mod+Ctrl+Alt+ArrowUp Meta+Enter Escape");
    expect(out).toContain("⌘");
    expect(out).toContain("⌃");
    expect(out).toContain("⌥");
    expect(out).toContain("↑");
    expect(out).toContain("↵");
    expect(out).toContain("Esc");
  });

  it("renders arrow glyphs across non-mac too", async () => {
    Object.defineProperty(navigator, "platform", { value: "Win32", configurable: true });
    const m = await freshModule();
    const out = m.formatBinding("Ctrl+Alt+ArrowDown Shift+ArrowLeft ArrowRight Meta+P");
    expect(out).toContain("↓");
    expect(out).toContain("←");
    expect(out).toContain("→");
    expect(out).toContain("Win");
    expect(out).toContain("Ctrl");
    expect(out).toContain("Alt");
    expect(out).toContain("Shift");
  });
});
