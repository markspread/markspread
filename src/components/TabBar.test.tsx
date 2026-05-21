import { cleanup, createEvent, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { PaneNode } from "../lib/editor/layout-model";
import { useEditorLayout } from "../store/editor-layout";
import type { EditorPosition, OpenTab } from "../store/tabs";
import { useTabs } from "../store/tabs";
import { TabBar } from "./TabBar";

afterEach(cleanup);

const POS: EditorPosition = { line: 0, column: 0, scrollTop: 0 };

function tab(path: string, extra: Partial<OpenTab> = {}): OpenTab {
  return { path, position: POS, ...extra };
}

function paneNode(tabs: PaneNode["tabs"], activeTabId: string | null = null): PaneNode {
  return {
    type: "pane",
    id: "pane-1",
    tabs,
    activeTabId: activeTabId ?? tabs[0]?.id ?? null,
  } as PaneNode;
}

describe("TabBar (legacy mode)", () => {
  beforeEach(() => {
    useTabs.setState({ tabs: [], activePath: null });
  });

  it("renders nothing with no tabs", () => {
    const { container } = render(<TabBar workspace="/ws" />);
    expect(container.firstChild).toBeNull();
  });

  it("renders open tabs with basenames", () => {
    useTabs.setState({
      tabs: [tab("/ws/a.md"), tab("/ws/sub/b.md", { dirty: true })],
      activePath: "/ws/a.md",
    });
    render(<TabBar workspace="/ws" />);
    expect(screen.getByText("a.md")).toBeTruthy();
    expect(screen.getByText("b.md")).toBeTruthy();
  });

  it("selects a tab on click", () => {
    useTabs.setState({ tabs: [tab("/ws/a.md"), tab("/ws/b.md")], activePath: "/ws/a.md" });
    render(<TabBar workspace="/ws" />);
    fireEvent.click(screen.getByText("b.md"));
    expect(useTabs.getState().activePath).toBe("/ws/b.md");
  });

  it("closes a tab via the close button", () => {
    useTabs.setState({ tabs: [tab("/ws/a.md")], activePath: "/ws/a.md" });
    render(<TabBar workspace="/ws" />);
    fireEvent.click(screen.getByLabelText("Close tab"));
    expect(useTabs.getState().tabs).toHaveLength(0);
  });

  it("pins a tab via the pin button", () => {
    useTabs.setState({ tabs: [tab("/ws/a.md")], activePath: "/ws/a.md" });
    render(<TabBar workspace="/ws" />);
    fireEvent.click(screen.getByLabelText("Pin tab"));
    expect(useTabs.getState().tabs[0]?.pinned).toBe(true);
  });

  it("closes a tab on middle-click", () => {
    useTabs.setState({ tabs: [tab("/ws/a.md")], activePath: "/ws/a.md" });
    render(<TabBar workspace="/ws" />);
    const tabEl = screen.getByText("a.md").closest('[role="tab"]') as HTMLElement;
    const auxEvent = new MouseEvent("auxclick", { bubbles: true, cancelable: true, button: 1 });
    fireEvent(tabEl, auxEvent);
    expect(useTabs.getState().tabs).toHaveLength(0);
  });

  it("ignores non-middle aux clicks", () => {
    useTabs.setState({ tabs: [tab("/ws/a.md")], activePath: "/ws/a.md" });
    render(<TabBar workspace="/ws" />);
    const tabEl = screen.getByText("a.md").closest('[role="tab"]') as HTMLElement;
    const auxEvent = new MouseEvent("auxclick", { bubbles: true, cancelable: true, button: 2 });
    fireEvent(tabEl, auxEvent);
    expect(useTabs.getState().tabs).toHaveLength(1);
  });

  it("selects a tab via Enter and Space keyboards", () => {
    useTabs.setState({ tabs: [tab("/ws/a.md"), tab("/ws/b.md")], activePath: "/ws/a.md" });
    render(<TabBar workspace="/ws" />);
    const bTab = screen.getByText("b.md").closest('[role="tab"]') as HTMLElement;
    fireEvent.keyDown(bTab, { key: "Enter" });
    expect(useTabs.getState().activePath).toBe("/ws/b.md");
    useTabs.setState({ activePath: "/ws/a.md" });
    fireEvent.keyDown(bTab, { key: " " });
    expect(useTabs.getState().activePath).toBe("/ws/b.md");
  });

  it("ignores non-action keys", () => {
    useTabs.setState({ tabs: [tab("/ws/a.md"), tab("/ws/b.md")], activePath: "/ws/a.md" });
    render(<TabBar workspace="/ws" />);
    const bTab = screen.getByText("b.md").closest('[role="tab"]') as HTMLElement;
    fireEvent.keyDown(bTab, { key: "x" });
    expect(useTabs.getState().activePath).toBe("/ws/a.md");
  });

  it("unpins a pinned tab via the pin button", () => {
    useTabs.setState({ tabs: [tab("/ws/a.md", { pinned: true })], activePath: "/ws/a.md" });
    render(<TabBar workspace="/ws" />);
    fireEvent.click(screen.getByLabelText("Unpin tab"));
    expect(useTabs.getState().tabs[0]?.pinned).toBe(false);
  });

  it("promotes a preview tab via double-click", () => {
    useTabs.setState({ tabs: [tab("/ws/a.md", { preview: true })], activePath: "/ws/a.md" });
    render(<TabBar workspace="/ws" />);
    const tabEl = screen.getByText("a.md").closest('[role="tab"]') as HTMLElement;
    fireEvent.doubleClick(tabEl);
    expect(useTabs.getState().tabs[0]?.pinned).toBe(true);
  });

  it("does not promote a non-preview tab on double-click", () => {
    useTabs.setState({ tabs: [tab("/ws/a.md")], activePath: "/ws/a.md" });
    render(<TabBar workspace="/ws" />);
    const tabEl = screen.getByText("a.md").closest('[role="tab"]') as HTMLElement;
    fireEvent.doubleClick(tabEl);
    expect(useTabs.getState().tabs[0]?.pinned).toBeFalsy();
  });

  it("renders the orphaned indicator", () => {
    useTabs.setState({
      tabs: [tab("/ws/a.md", { orphaned: true })],
      activePath: "/ws/a.md",
    });
    render(<TabBar workspace="/ws" />);
    expect(screen.getByTitle("File no longer exists on disk")).toBeTruthy();
  });

  it("displays the full path for tabs outside the workspace", () => {
    useTabs.setState({
      tabs: [tab("/elsewhere/c.md")],
      activePath: "/elsewhere/c.md",
    });
    render(<TabBar workspace="/ws" />);
    const span = screen.getByText("c.md").parentElement?.querySelector("[aria-label]");
    expect(span?.getAttribute("aria-label")).toBe("/elsewhere/c.md");
  });

  it("reorders tabs when one is dragged onto another", () => {
    useTabs.setState({
      tabs: [tab("/ws/a.md"), tab("/ws/b.md"), tab("/ws/c.md")],
      activePath: "/ws/a.md",
    });
    render(<TabBar workspace="/ws" />);
    const aTab = screen.getByText("a.md").closest('[role="tab"]') as HTMLElement;
    const cTab = screen.getByText("c.md").closest('[role="tab"]') as HTMLElement;
    const stored: Record<string, string> = {};
    const dt = {
      types: ["application/x-markspread-tab"],
      effectAllowed: "",
      dropEffect: "",
      setData: (k: string, v: string) => {
        stored[k] = v;
      },
      getData: (k: string) => stored[k] ?? "",
    } as unknown as DataTransfer;
    const startEvt = createEvent.dragStart(aTab);
    Object.defineProperty(startEvt, "dataTransfer", { value: dt });
    fireEvent(aTab, startEvt);
    cTab.getBoundingClientRect = () =>
      ({ left: 0, top: 0, width: 100, height: 20, right: 100, bottom: 20, x: 0, y: 0 }) as DOMRect;
    const overEvt = createEvent.dragOver(cTab);
    Object.defineProperty(overEvt, "dataTransfer", { value: dt });
    Object.defineProperty(overEvt, "clientX", { value: 10 });
    fireEvent(cTab, overEvt);
    const dropEvt = createEvent.drop(cTab);
    Object.defineProperty(dropEvt, "dataTransfer", { value: dt });
    Object.defineProperty(dropEvt, "clientX", { value: 10 });
    fireEvent(cTab, dropEvt);
    const order = useTabs.getState().tabs.map((t) => t.path);
    // Dropped near the left edge of c.md → a.md slots before c.md.
    expect(order).toEqual(["/ws/b.md", "/ws/a.md", "/ws/c.md"]);
  });

  it("renders the after-drop hint when hovering the right half", () => {
    useTabs.setState({
      tabs: [tab("/ws/a.md"), tab("/ws/b.md")],
      activePath: "/ws/a.md",
    });
    render(<TabBar workspace="/ws" />);
    const aTab = screen.getByText("a.md").closest('[role="tab"]') as HTMLElement;
    aTab.getBoundingClientRect = () =>
      ({ left: 0, top: 0, width: 100, height: 20, right: 100, bottom: 20, x: 0, y: 0 }) as DOMRect;
    const overEvt = createEvent.dragOver(aTab);
    Object.defineProperty(overEvt, "dataTransfer", {
      value: { types: ["application/x-markspread-tab"], dropEffect: "" },
    });
    Object.defineProperty(overEvt, "clientX", { value: 80 });
    fireEvent(aTab, overEvt);
    expect(aTab.querySelector("span.right-0")).not.toBeNull();
  });

  it("renders the before-drop hint when hovering the left half", () => {
    useTabs.setState({
      tabs: [tab("/ws/a.md"), tab("/ws/b.md")],
      activePath: "/ws/a.md",
    });
    render(<TabBar workspace="/ws" />);
    const aTab = screen.getByText("a.md").closest('[role="tab"]') as HTMLElement;
    aTab.getBoundingClientRect = () =>
      ({ left: 0, top: 0, width: 100, height: 20, right: 100, bottom: 20, x: 0, y: 0 }) as DOMRect;
    const overEvt = createEvent.dragOver(aTab);
    Object.defineProperty(overEvt, "dataTransfer", {
      value: { types: ["application/x-markspread-tab"], dropEffect: "" },
    });
    Object.defineProperty(overEvt, "clientX", { value: 10 });
    fireEvent(aTab, overEvt);
    expect(aTab.querySelector("span.left-0")).not.toBeNull();
  });

  it("ignores drag-over with an unrelated MIME", () => {
    useTabs.setState({ tabs: [tab("/ws/a.md")], activePath: "/ws/a.md" });
    render(<TabBar workspace="/ws" />);
    const aTab = screen.getByText("a.md").closest('[role="tab"]') as HTMLElement;
    const overEvt = createEvent.dragOver(aTab);
    Object.defineProperty(overEvt, "dataTransfer", {
      value: { types: ["text/plain"], dropEffect: "" },
    });
    fireEvent(aTab, overEvt);
    expect(aTab.querySelector('span[aria-hidden="true"].absolute.left-0')).toBeNull();
  });

  it("ignores a self-drop", () => {
    useTabs.setState({ tabs: [tab("/ws/a.md")], activePath: "/ws/a.md" });
    render(<TabBar workspace="/ws" />);
    const aTab = screen.getByText("a.md").closest('[role="tab"]') as HTMLElement;
    const stored: Record<string, string> = { "application/x-markspread-tab": "/ws/a.md" };
    const dt = {
      types: ["application/x-markspread-tab"],
      effectAllowed: "",
      dropEffect: "",
      setData: (k: string, v: string) => {
        stored[k] = v;
      },
      getData: (k: string) => stored[k] ?? "",
    } as unknown as DataTransfer;
    const dropEvt = createEvent.drop(aTab);
    Object.defineProperty(dropEvt, "dataTransfer", { value: dt });
    Object.defineProperty(dropEvt, "clientX", { value: 10 });
    fireEvent(aTab, dropEvt);
    expect(useTabs.getState().tabs[0]?.path).toBe("/ws/a.md");
  });

  it("clears the drop hint when the drag leaves the strip", () => {
    useTabs.setState({
      tabs: [tab("/ws/a.md"), tab("/ws/b.md")],
      activePath: "/ws/a.md",
    });
    render(<TabBar workspace="/ws" />);
    const strip = screen.getByRole("tablist");
    const aTab = screen.getByText("a.md").closest('[role="tab"]') as HTMLElement;
    aTab.getBoundingClientRect = () =>
      ({ left: 0, top: 0, width: 100, height: 20, right: 100, bottom: 20, x: 0, y: 0 }) as DOMRect;
    const overEvt = createEvent.dragOver(aTab);
    Object.defineProperty(overEvt, "dataTransfer", {
      value: { types: ["application/x-markspread-tab"], dropEffect: "" },
    });
    Object.defineProperty(overEvt, "clientX", { value: 10 });
    fireEvent(aTab, overEvt);
    const leaveEvt = new Event("dragleave", { bubbles: true });
    Object.defineProperty(leaveEvt, "relatedTarget", { value: document.body });
    strip.dispatchEvent(leaveEvt);
  });

  it("keeps the drop hint when the drag stays within the strip", () => {
    useTabs.setState({
      tabs: [tab("/ws/a.md"), tab("/ws/b.md")],
      activePath: "/ws/a.md",
    });
    render(<TabBar workspace="/ws" />);
    const strip = screen.getByRole("tablist");
    const aTab = screen.getByText("a.md").closest('[role="tab"]') as HTMLElement;
    aTab.getBoundingClientRect = () =>
      ({ left: 0, top: 0, width: 100, height: 20, right: 100, bottom: 20, x: 0, y: 0 }) as DOMRect;
    const overEvt = createEvent.dragOver(aTab);
    Object.defineProperty(overEvt, "dataTransfer", {
      value: { types: ["application/x-markspread-tab"], dropEffect: "" },
    });
    Object.defineProperty(overEvt, "clientX", { value: 10 });
    fireEvent(aTab, overEvt);
    const leaveEvt = new Event("dragleave", { bubbles: true });
    Object.defineProperty(leaveEvt, "relatedTarget", { value: aTab });
    strip.dispatchEvent(leaveEvt);
  });
});

describe("TabBar (pane mode)", () => {
  it("renders pane tabs and selects via the editor-layout store", () => {
    const setActiveTab = vi.fn();
    useEditorLayout.setState({ setActiveTab } as never);
    const pane = paneNode([
      {
        id: "t-a",
        path: "/ws/a.md",
        position: POS,
      },
      {
        id: "t-b",
        path: "/ws/b.md",
        position: POS,
      },
    ]);
    render(<TabBar workspace="/ws" pane={pane} />);
    fireEvent.click(screen.getByText("b.md"));
    expect(setActiveTab).toHaveBeenCalledWith("/ws", "pane-1", "t-b");
  });

  it("closes a pane tab via the close button", () => {
    const closeTab = vi.fn();
    useEditorLayout.setState({ closeTab } as never);
    const pane = paneNode([
      {
        id: "t-a",
        path: "/ws/a.md",
        position: POS,
      },
    ]);
    render(<TabBar workspace="/ws" pane={pane} />);
    fireEvent.click(screen.getByLabelText("Close tab"));
    expect(closeTab).toHaveBeenCalledWith("/ws", "pane-1", "t-a");
  });

  it("toggles pin via setTabPinned", () => {
    const setTabPinned = vi.fn();
    useEditorLayout.setState({ setTabPinned } as never);
    const pane = paneNode([
      {
        id: "t-a",
        path: "/ws/a.md",
        position: POS,
      },
    ]);
    render(<TabBar workspace="/ws" pane={pane} />);
    fireEvent.click(screen.getByLabelText("Pin tab"));
    expect(setTabPinned).toHaveBeenCalledWith("/ws", "pane-1", "t-a", true);
  });

  it("promotes a pane preview tab via double-click", () => {
    const setTabPinned = vi.fn();
    useEditorLayout.setState({ setTabPinned } as never);
    const pane = paneNode([
      {
        id: "t-a",
        path: "/ws/a.md",
        position: POS,
        preview: true,
      },
    ]);
    render(<TabBar workspace="/ws" pane={pane} />);
    const tabEl = screen.getByText("a.md").closest('[role="tab"]') as HTMLElement;
    fireEvent.doubleClick(tabEl);
    expect(setTabPinned).toHaveBeenCalledWith("/ws", "pane-1", "t-a", true);
  });

  it("moves a pane tab via drag-and-drop", () => {
    const moveTab = vi.fn();
    useEditorLayout.setState({ moveTab } as never);
    const pane = paneNode([
      { id: "t-a", path: "/ws/a.md", position: POS },
      { id: "t-b", path: "/ws/b.md", position: POS },
    ]);
    render(<TabBar workspace="/ws" pane={pane} />);
    const aTab = screen.getByText("a.md").closest('[role="tab"]') as HTMLElement;
    const bTab = screen.getByText("b.md").closest('[role="tab"]') as HTMLElement;
    const stored: Record<string, string> = {};
    const dt = {
      types: ["application/x-markspread-tab"],
      effectAllowed: "",
      dropEffect: "",
      setData: (k: string, v: string) => {
        stored[k] = v;
      },
      getData: (k: string) => stored[k] ?? "",
    } as unknown as DataTransfer;
    const startEvt = createEvent.dragStart(aTab);
    Object.defineProperty(startEvt, "dataTransfer", { value: dt });
    fireEvent(aTab, startEvt);
    bTab.getBoundingClientRect = () =>
      ({ left: 0, top: 0, width: 100, height: 20, right: 100, bottom: 20, x: 0, y: 0 }) as DOMRect;
    const dropEvt = createEvent.drop(bTab);
    Object.defineProperty(dropEvt, "dataTransfer", { value: dt });
    Object.defineProperty(dropEvt, "clientX", { value: 80 });
    fireEvent(bTab, dropEvt);
    expect(moveTab).toHaveBeenCalled();
  });

  it("ignores a pane drop when the dragged tab is unknown", () => {
    const moveTab = vi.fn();
    useEditorLayout.setState({ moveTab } as never);
    const pane = paneNode([
      { id: "t-a", path: "/ws/a.md", position: POS },
      { id: "t-b", path: "/ws/b.md", position: POS },
    ]);
    render(<TabBar workspace="/ws" pane={pane} />);
    const bTab = screen.getByText("b.md").closest('[role="tab"]') as HTMLElement;
    bTab.getBoundingClientRect = () =>
      ({ left: 0, top: 0, width: 100, height: 20, right: 100, bottom: 20, x: 0, y: 0 }) as DOMRect;
    const stored: Record<string, string> = {
      "application/x-markspread-tab": "t-unknown",
    };
    const dt = {
      types: ["application/x-markspread-tab"],
      effectAllowed: "",
      dropEffect: "",
      setData: (k: string, v: string) => {
        stored[k] = v;
      },
      getData: (k: string) => stored[k] ?? "",
    } as unknown as DataTransfer;
    const dropEvt = createEvent.drop(bTab);
    Object.defineProperty(dropEvt, "dataTransfer", { value: dt });
    Object.defineProperty(dropEvt, "clientX", { value: 10 });
    fireEvent(bTab, dropEvt);
    expect(moveTab).not.toHaveBeenCalled();
  });

  it("moves a pane tab to the left when dropped on the left half", () => {
    const moveTab = vi.fn();
    useEditorLayout.setState({ moveTab } as never);
    const pane = paneNode([
      { id: "t-a", path: "/ws/a.md", position: POS },
      { id: "t-b", path: "/ws/b.md", position: POS },
    ]);
    render(<TabBar workspace="/ws" pane={pane} />);
    const aTab = screen.getByText("a.md").closest('[role="tab"]') as HTMLElement;
    const bTab = screen.getByText("b.md").closest('[role="tab"]') as HTMLElement;
    const stored: Record<string, string> = {};
    const dt = {
      types: ["application/x-markspread-tab"],
      effectAllowed: "",
      dropEffect: "",
      setData: (k: string, v: string) => {
        stored[k] = v;
      },
      getData: (k: string) => stored[k] ?? "",
    } as unknown as DataTransfer;
    const startEvt = createEvent.dragStart(bTab);
    Object.defineProperty(startEvt, "dataTransfer", { value: dt });
    fireEvent(bTab, startEvt);
    aTab.getBoundingClientRect = () =>
      ({ left: 0, top: 0, width: 100, height: 20, right: 100, bottom: 20, x: 0, y: 0 }) as DOMRect;
    const dropEvt = createEvent.drop(aTab);
    Object.defineProperty(dropEvt, "dataTransfer", { value: dt });
    Object.defineProperty(dropEvt, "clientX", { value: 10 });
    fireEvent(aTab, dropEvt);
    expect(moveTab).toHaveBeenCalled();
  });

  it("renders the basename verbatim for paths without a separator", () => {
    useEditorLayout.setState({ setActiveTab: vi.fn() } as never);
    const pane = paneNode([{ id: "t-x", path: "loosefile.md", position: POS }]);
    render(<TabBar workspace="/ws" pane={pane} />);
    expect(screen.getByText("loosefile.md")).toBeTruthy();
  });

  it("sorts pinned pane tabs to the front", () => {
    useEditorLayout.setState({ setActiveTab: vi.fn() } as never);
    const pane = paneNode([
      { id: "t-a", path: "/ws/a.md", position: POS },
      { id: "t-b", path: "/ws/b.md", position: POS, pinned: true },
    ]);
    render(<TabBar workspace="/ws" pane={pane} />);
    const tabs = screen.getAllByRole("tab");
    expect(tabs[0]?.textContent).toContain("b.md");
  });
});
