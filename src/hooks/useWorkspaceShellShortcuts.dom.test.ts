// S-MWS-004: 워크스페이스 셸 단축키 hook 의 jsdom 단위 테스트.

import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { useWorkspace } from "../store/workspace";
import {
  createTabsNode,
  createWorkspaceTab,
  emptyWindowLayout,
  forEachTabsNode,
  useWorkspaceLayout,
} from "../store/workspace-layout";
import { activeTabsNodeSize, useWorkspaceShellShortcuts } from "./useWorkspaceShellShortcuts";

function fire(
  key: string,
  opts: { meta?: boolean; ctrl?: boolean; shift?: boolean; alt?: boolean } = {},
): KeyboardEvent {
  const evt = new KeyboardEvent("keydown", {
    key,
    metaKey: !!opts.meta,
    ctrlKey: !!opts.ctrl,
    shiftKey: !!opts.shift,
    altKey: !!opts.alt,
    bubbles: true,
    cancelable: true,
  });
  act(() => {
    window.dispatchEvent(evt);
  });
  return evt;
}

function setPlatform(platform: string) {
  Object.defineProperty(navigator, "platform", {
    value: platform,
    configurable: true,
  });
}

// 테스트별로 mount/unmount 를 추적해 리스너가 누적되지 않도록 한다.
const mounted: Array<{ unmount: () => void }> = [];

function mount() {
  const h = renderHook(() => useWorkspaceShellShortcuts());
  mounted.push(h);
}

describe("useWorkspaceShellShortcuts", () => {
  beforeEach(() => {
    setPlatform("MacIntel");
    useWorkspaceLayout.setState({ layout: null });
    // ADR-0010 scope: these shortcuts only fire when the editor shell
    // is the active scope. Pin `preferredShell: 'editor'` so the
    // existing matrix still exercises the binding behaviour.
    useWorkspace.setState({ current: "/ws-a", readOnly: false, preferredShell: "editor" });
  });

  afterEach(() => {
    while (mounted.length > 0) mounted.pop()?.unmount();
    useWorkspaceLayout.setState({ layout: null });
    useWorkspace.setState({ current: null, readOnly: false });
  });

  it("is a noop when no layout exists", () => {
    mount();
    fire("t", { meta: true });
    expect(useWorkspaceLayout.getState().layout).toBeNull();
  });

  it("Mod+T adds a new workspace tab cloned from the active path", () => {
    useWorkspaceLayout.setState({ layout: emptyWindowLayout("/ws-a") });
    mount();
    fire("t", { meta: true });
    expect(activeTabsNodeSize()).toBe(2);
  });

  it("Mod+T does nothing if active tab id is orphaned", () => {
    useWorkspaceLayout.setState({ layout: emptyWindowLayout("/ws-a") });
    const layout = useWorkspaceLayout.getState().layout;
    if (!layout) throw new Error("setup");
    useWorkspaceLayout.setState({ layout: { ...layout, activeTabId: "missing" } });
    mount();
    fire("t", { meta: true });
    expect(activeTabsNodeSize()).toBe(0);
  });

  it("Mod+W closes the active tab and falls back to workspace.close on last tab", () => {
    useWorkspaceLayout.setState({ layout: emptyWindowLayout("/ws-a") });
    useWorkspaceLayout.getState().addWorkspaceTab("/ws-b");
    mount();
    expect(activeTabsNodeSize()).toBe(2);
    fire("w", { meta: true });
    expect(activeTabsNodeSize()).toBe(1);
    fire("w", { meta: true });
    expect(useWorkspace.getState().current).toBeNull();
  });

  it("Mod+\\ splits vertically", () => {
    useWorkspaceLayout.setState({ layout: emptyWindowLayout("/ws-a") });
    mount();
    fire("\\", { meta: true });
    expect(useWorkspaceLayout.getState().layout?.root.type).toBe("ws-split");
  });

  it("Mod+Shift+\\ splits horizontally (key='\\\\')", () => {
    useWorkspaceLayout.setState({ layout: emptyWindowLayout("/ws-a") });
    mount();
    fire("\\", { meta: true, shift: true });
    const root = useWorkspaceLayout.getState().layout?.root;
    expect(root?.type).toBe("ws-split");
    if (root?.type === "ws-split") expect(root.direction).toBe("vertical");
  });

  it("Mod+Shift+\\ also matches key='|' (shifted backslash)", () => {
    useWorkspaceLayout.setState({ layout: emptyWindowLayout("/ws-a") });
    mount();
    fire("|", { meta: true, shift: true });
    expect(useWorkspaceLayout.getState().layout?.root.type).toBe("ws-split");
  });

  it("Mod+1..9 is a noop when root is a single ws-tabs (D7 fallback)", () => {
    useWorkspaceLayout.setState({ layout: emptyWindowLayout("/ws-a") });
    useWorkspaceLayout.getState().addWorkspaceTab("/ws-b");
    mount();
    const before = useWorkspaceLayout.getState().layout?.activeTabId;
    const evt = fire("1", { meta: true });
    expect(evt.defaultPrevented).toBe(false);
    expect(useWorkspaceLayout.getState().layout?.activeTabId).toBe(before);
  });

  it("Mod+N jumps to nth workspace tab when a split exists", () => {
    useWorkspaceLayout.setState({ layout: emptyWindowLayout("/ws-a") });
    useWorkspaceLayout.getState().splitVertical();
    useWorkspaceLayout.getState().addWorkspaceTab("/ws-c");
    mount();
    const layout = useWorkspaceLayout.getState().layout;
    if (!layout) throw new Error("setup");
    let firstId: string | null = null;
    forEachTabsNode(layout.root, (n) => {
      if (n.tabs.some((t) => t.id === layout.activeTabId)) {
        firstId = n.tabs[0]?.id ?? null;
        return false;
      }
    });
    fire("1", { meta: true });
    expect(useWorkspaceLayout.getState().layout?.activeTabId).toBe(firstId);
  });

  it("Mod+N is a noop when the index is out of range", () => {
    useWorkspaceLayout.setState({ layout: emptyWindowLayout("/ws-a") });
    useWorkspaceLayout.getState().splitVertical();
    mount();
    const before = useWorkspaceLayout.getState().layout?.activeTabId;
    fire("9", { meta: true });
    expect(useWorkspaceLayout.getState().layout?.activeTabId).toBe(before);
  });

  it("Mod+N is a noop when the active id cannot be located", () => {
    useWorkspaceLayout.setState({ layout: emptyWindowLayout("/ws-a") });
    useWorkspaceLayout.getState().splitVertical();
    const layout = useWorkspaceLayout.getState().layout;
    if (!layout) throw new Error("setup");
    useWorkspaceLayout.setState({ layout: { ...layout, activeTabId: "orphan" } });
    mount();
    const evt = fire("1", { meta: true });
    expect(evt.defaultPrevented).toBe(false);
  });

  it("non-mod keys are ignored", () => {
    useWorkspaceLayout.setState({ layout: emptyWindowLayout("/ws-a") });
    mount();
    fire("t");
    fire("w");
    fire("\\");
    expect(activeTabsNodeSize()).toBe(1);
  });

  it("non-Mac platform uses ctrlKey for the modifier", () => {
    setPlatform("Win32");
    useWorkspaceLayout.setState({ layout: emptyWindowLayout("/ws-a") });
    mount();
    fire("t", { ctrl: true });
    expect(activeTabsNodeSize()).toBe(2);
  });

  it("removes its listener on unmount", () => {
    useWorkspaceLayout.setState({ layout: emptyWindowLayout("/ws-a") });
    const h = renderHook(() => useWorkspaceShellShortcuts());
    h.unmount();
    fire("t", { meta: true });
    expect(activeTabsNodeSize()).toBe(1);
  });

  it("activeTabsNodeSize returns 0 when no layout is present", () => {
    useWorkspaceLayout.setState({ layout: null });
    expect(activeTabsNodeSize()).toBe(0);
  });

  it("activeTabsNodeSize returns 0 when active id is in no node", () => {
    const t1 = createWorkspaceTab("/a");
    const node = createTabsNode([t1], t1.id);
    useWorkspaceLayout.setState({
      layout: { schemaVersion: 2, root: node, activeTabId: "missing" },
    });
    expect(activeTabsNodeSize()).toBe(0);
  });

  // ADR-0010 R3 scope gate: the chat shell must own its keymap. When
  // the workspace's preferredShell flips to chat, our hook stays
  // silent so the chat input box keeps Mod+T etc. for its own use.
  it("yields when the chat shell is the active scope", () => {
    useWorkspace.setState({ current: "/ws-a", preferredShell: "chat" });
    useWorkspaceLayout.setState({ layout: emptyWindowLayout("/ws-a") });
    mount();
    const sizeBefore = activeTabsNodeSize();
    fire("t", { meta: true });
    expect(activeTabsNodeSize()).toBe(sizeBefore);
  });

  // Defensive branch in `isEditorScopeActive`: no workspace open means
  // the scope gate must let through (we want the shortcut to behave on
  // the Welcome screen too — though currently the layout guard inside
  // the handler still short-circuits).
  it("treats 'no workspace open' as editor scope so the inner layout guard runs", () => {
    useWorkspace.setState({ current: null, preferredShell: "chat" });
    mount();
    fire("t", { meta: true });
    // No layout means the handler bails after the scope check — no
    // throw, no state mutation.
    expect(useWorkspaceLayout.getState().layout).toBeNull();
  });
});
