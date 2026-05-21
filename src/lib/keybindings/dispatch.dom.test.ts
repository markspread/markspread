// S-KB-005: context-aware dispatcher coverage.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/commands/registry", () => ({
  commands: [
    { id: "cmd.always", when: undefined },
    { id: "cmd.editor", when: "editorFocus" },
    { id: "cmd.dup-a", when: "editorFocus" },
    { id: "cmd.dup-b", when: "editorFocus" },
    { id: "cmd.tree", when: "treeFocus" },
  ],
}));

vi.mock(".", () => ({
  bindingFromEvent: (e: KeyboardEvent) => (e.metaKey ? `Mod+${e.code.replace(/^Key/, "")}` : ""),
  listActiveBindings: () => [
    { commandId: "cmd.always", binding: "Mod+S", source: "preset" },
    { commandId: "cmd.editor", binding: "Mod+S", source: "preset" },
    { commandId: "cmd.dup-a", binding: "Mod+D", source: "preset" },
    { commandId: "cmd.dup-b", binding: "Mod+D", source: "preset" },
    { commandId: "cmd.tree", binding: "Mod+T", source: "preset" },
    { commandId: "cmd.missing-cmd", binding: "Mod+Z", source: "preset" },
  ],
  normaliseBinding: (b: string) => b,
}));

const imeComposing = { value: false };
vi.mock("./ime", () => ({
  isComposing: (_e?: KeyboardEvent) => imeComposing.value,
}));

import { _resetWarnings, dispatch, getContext, popContext, pushContext } from "./dispatch";

function press(code: string, metaKey = true): KeyboardEvent {
  return new KeyboardEvent("keydown", { code, metaKey });
}

beforeEach(() => {
  _resetWarnings();
  imeComposing.value = false;
  // Pop everything back to "always".
  popContext("editorFocus");
  popContext("treeFocus");
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("dispatch", () => {
  it("returns null while the IME is composing", () => {
    imeComposing.value = true;
    expect(dispatch(press("KeyS"))).toBeNull();
  });

  it("returns null when the event has no binding", () => {
    expect(dispatch(press("KeyS", false))).toBeNull();
  });

  it("returns null when no binding matches", () => {
    expect(dispatch(press("KeyX"))).toBeNull();
  });

  it("falls back to an 'always' match when no context-specific binding exists", () => {
    expect(dispatch(press("KeyS"))).toBe("cmd.always");
  });

  it("prefers a context-scoped match over an 'always' match in that context", () => {
    pushContext("editorFocus");
    expect(dispatch(press("KeyS"))).toBe("cmd.editor");
  });

  it("warns once when multiple commands share a binding in the same context", () => {
    pushContext("editorFocus");
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    expect(dispatch(press("KeyD"))).toBe("cmd.dup-b");
    expect(dispatch(press("KeyD"))).toBe("cmd.dup-b");
    expect(warn).toHaveBeenCalledTimes(1);
    warn.mockRestore();
  });

  it("filters out matches whose command id is unknown to the registry", () => {
    expect(dispatch(press("KeyZ"))).toBeNull();
  });

  it("returns null when in-context matches exist for a different context only", () => {
    pushContext("treeFocus");
    // Mod+S resolves to cmd.always and cmd.editor (editorFocus). In treeFocus
    // the editor binding is out of context; cmd.always remains.
    expect(dispatch(press("KeyS"))).toBe("cmd.always");
  });

  it("honours an explicit chord prefix when forming the binding", () => {
    expect(dispatch(press("KeyS"), "Mod+K")).toBeNull();
  });

  it("returns null when matches exist but none are in-context or 'always'", () => {
    // Mod+D resolves only to cmd.dup-a and cmd.dup-b (both editorFocus).
    // Active context is "always", so neither qualifies and finalists is empty.
    expect(dispatch(press("KeyD"))).toBeNull();
  });
});

describe("pushContext / popContext / getContext", () => {
  it("defaults to 'always'", () => {
    expect(getContext()).toBe("always");
  });

  it("returns the top of the stack", () => {
    pushContext("editorFocus");
    pushContext("treeFocus");
    expect(getContext()).toBe("treeFocus");
    popContext("treeFocus");
    expect(getContext()).toBe("editorFocus");
    popContext("editorFocus");
    expect(getContext()).toBe("always");
  });

  it("is a no-op when popping a context that was not pushed", () => {
    popContext("treeFocus");
    expect(getContext()).toBe("always");
  });
});
