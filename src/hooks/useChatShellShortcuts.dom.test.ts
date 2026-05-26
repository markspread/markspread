// @vitest-environment jsdom
import { renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useWorkspace } from "../store/workspace";
import { useChatShellShortcuts } from "./useChatShellShortcuts";

function setPlatform(p: string) {
  Object.defineProperty(navigator, "platform", { value: p, configurable: true });
}

function fireKey(key: string, opts: { meta?: boolean; ctrl?: boolean; shift?: boolean } = {}) {
  const ev = new KeyboardEvent("keydown", {
    key,
    metaKey: opts.meta ?? false,
    ctrlKey: opts.ctrl ?? false,
    shiftKey: opts.shift ?? false,
    bubbles: true,
    cancelable: true,
  });
  window.dispatchEvent(ev);
  return ev;
}

const mounted: ReturnType<typeof renderHook>[] = [];

function makeHandlers() {
  return {
    onSend: vi.fn(),
    onFocusInput: vi.fn(),
    onToggleContext: vi.fn(),
    onToggleNav: vi.fn(),
  };
}

describe("useChatShellShortcuts", () => {
  beforeEach(() => {
    setPlatform("MacIntel");
    useWorkspace.setState({ current: "/ws", preferredShell: "chat" });
  });
  afterEach(() => {
    while (mounted.length > 0) mounted.pop()?.unmount();
    useWorkspace.setState({ current: null, preferredShell: "chat" });
  });

  it("Mod+Enter fires onSend", () => {
    const h = makeHandlers();
    mounted.push(renderHook(() => useChatShellShortcuts(h)));
    fireKey("Enter", { meta: true });
    expect(h.onSend).toHaveBeenCalled();
  });

  it("Mod+K fires onFocusInput", () => {
    const h = makeHandlers();
    mounted.push(renderHook(() => useChatShellShortcuts(h)));
    fireKey("k", { meta: true });
    expect(h.onFocusInput).toHaveBeenCalled();
  });

  it("Mod+/ toggles the context panel", () => {
    const h = makeHandlers();
    mounted.push(renderHook(() => useChatShellShortcuts(h)));
    fireKey("/", { meta: true });
    expect(h.onToggleContext).toHaveBeenCalled();
  });

  it("Mod+Shift+/ toggles the nav (with key='?')", () => {
    const h = makeHandlers();
    mounted.push(renderHook(() => useChatShellShortcuts(h)));
    fireKey("?", { meta: true, shift: true });
    expect(h.onToggleNav).toHaveBeenCalled();
  });

  it("Mod+Shift+/ also matches key='/'", () => {
    const h = makeHandlers();
    mounted.push(renderHook(() => useChatShellShortcuts(h)));
    fireKey("/", { meta: true, shift: true });
    expect(h.onToggleNav).toHaveBeenCalled();
  });

  it("yields when the editor shell is active", () => {
    useWorkspace.setState({ current: "/ws", preferredShell: "editor" });
    const h = makeHandlers();
    mounted.push(renderHook(() => useChatShellShortcuts(h)));
    fireKey("Enter", { meta: true });
    fireKey("k", { meta: true });
    fireKey("/", { meta: true });
    expect(h.onSend).not.toHaveBeenCalled();
    expect(h.onFocusInput).not.toHaveBeenCalled();
    expect(h.onToggleContext).not.toHaveBeenCalled();
  });

  it("yields when no workspace is open", () => {
    useWorkspace.setState({ current: null, preferredShell: "chat" });
    const h = makeHandlers();
    mounted.push(renderHook(() => useChatShellShortcuts(h)));
    fireKey("Enter", { meta: true });
    expect(h.onSend).not.toHaveBeenCalled();
  });

  it("yields when no modifier is held", () => {
    const h = makeHandlers();
    mounted.push(renderHook(() => useChatShellShortcuts(h)));
    fireKey("Enter");
    fireKey("k");
    fireKey("/");
    expect(h.onSend).not.toHaveBeenCalled();
    expect(h.onFocusInput).not.toHaveBeenCalled();
    expect(h.onToggleContext).not.toHaveBeenCalled();
  });

  it("ctrl is the modifier on non-mac", () => {
    setPlatform("Win32");
    const h = makeHandlers();
    mounted.push(renderHook(() => useChatShellShortcuts(h)));
    fireKey("Enter", { ctrl: true });
    expect(h.onSend).toHaveBeenCalled();
  });

  it("ignores unrelated keys", () => {
    const h = makeHandlers();
    mounted.push(renderHook(() => useChatShellShortcuts(h)));
    fireKey("a", { meta: true });
    expect(h.onSend).not.toHaveBeenCalled();
    expect(h.onFocusInput).not.toHaveBeenCalled();
  });
});
