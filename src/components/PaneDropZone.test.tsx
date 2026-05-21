import { cleanup, createEvent, fireEvent, render } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { useEditorLayout } from "../store/editor-layout";
import { PaneDropZone, TAB_DRAG_MIME, regionForPoint } from "./PaneDropZone";

afterEach(cleanup);

const RECT = { left: 0, top: 0, width: 100, height: 100 };

describe("regionForPoint", () => {
  it("classifies the centre", () => {
    expect(regionForPoint(50, 50, RECT)).toBe("center");
  });
  it("classifies edges", () => {
    expect(regionForPoint(5, 50, RECT)).toBe("left");
    expect(regionForPoint(95, 50, RECT)).toBe("right");
    expect(regionForPoint(50, 5, RECT)).toBe("top");
    expect(regionForPoint(50, 95, RECT)).toBe("bottom");
  });
});

describe("PaneDropZone", () => {
  it("renders nothing when inactive", () => {
    const { container } = render(<PaneDropZone workspace="/ws" paneId="pane-1" isActive={false} />);
    expect(container.firstChild).toBeNull();
  });

  it("renders an overlay when active", () => {
    const { container } = render(<PaneDropZone workspace="/ws" paneId="pane-1" isActive />);
    expect(container.querySelector('[data-pane-drop-zone="pane-1"]')).not.toBeNull();
  });

  it("shows a region hint on dragover", () => {
    const { container } = render(<PaneDropZone workspace="/ws" paneId="pane-1" isActive />);
    const zone = container.querySelector('[data-pane-drop-zone="pane-1"]') as HTMLElement;
    fireEvent.dragOver(zone, {
      dataTransfer: { types: [TAB_DRAG_MIME], dropEffect: "" },
      clientX: 50,
      clientY: 50,
    });
    expect(zone.querySelector("span")).not.toBeNull();
  });

  it("moves a tab on a centre drop", () => {
    const moveTab = useEditorLayout.getState().moveTab;
    const spy = vi.fn(moveTab);
    useEditorLayout.setState({ moveTab: spy });
    const { container } = render(<PaneDropZone workspace="/ws" paneId="pane-1" isActive />);
    const zone = container.querySelector('[data-pane-drop-zone="pane-1"]') as HTMLElement;
    stubRect(zone);
    fireEvent(
      zone,
      makeDropEvent(50, 50, JSON.stringify({ fromPaneId: "pane-0", tabId: "tab-9" })),
    );
    expect(spy).toHaveBeenCalled();
    useEditorLayout.setState({ moveTab });
  });

  it("ignores dragover when the drag carries an unrelated MIME", () => {
    const { container } = render(<PaneDropZone workspace="/ws" paneId="pane-1" isActive />);
    const zone = container.querySelector('[data-pane-drop-zone="pane-1"]') as HTMLElement;
    fireEvent.dragOver(zone, {
      dataTransfer: { types: ["text/plain"], dropEffect: "" },
      clientX: 50,
      clientY: 50,
    });
    expect(zone.querySelector("span")).toBeNull();
  });

  it("clears the hint when the drag leaves the overlay", () => {
    const { container } = render(<PaneDropZone workspace="/ws" paneId="pane-1" isActive />);
    const zone = container.querySelector('[data-pane-drop-zone="pane-1"]') as HTMLElement;
    fireEvent.dragOver(zone, {
      dataTransfer: { types: [TAB_DRAG_MIME], dropEffect: "" },
      clientX: 50,
      clientY: 50,
    });
    expect(zone.querySelector("span")).not.toBeNull();
    const leaveEvt = new Event("dragleave", { bubbles: true }) as DragEvent;
    Object.defineProperty(leaveEvt, "relatedTarget", { value: document.body });
    zone.dispatchEvent(leaveEvt);
  });

  it("keeps the hint when the drag enters a child node of the overlay", () => {
    const { container } = render(<PaneDropZone workspace="/ws" paneId="pane-1" isActive />);
    const zone = container.querySelector('[data-pane-drop-zone="pane-1"]') as HTMLElement;
    fireEvent.dragOver(zone, {
      dataTransfer: { types: [TAB_DRAG_MIME], dropEffect: "" },
      clientX: 50,
      clientY: 50,
    });
    const child = document.createElement("div");
    zone.appendChild(child);
    const leaveEvt = new Event("dragleave", { bubbles: true }) as DragEvent;
    Object.defineProperty(leaveEvt, "relatedTarget", { value: child });
    zone.dispatchEvent(leaveEvt);
    expect(zone.querySelector("span")).not.toBeNull();
  });

  it("ignores a drop with no payload string", () => {
    const moveTab = useEditorLayout.getState().moveTab;
    const spy = vi.fn(moveTab);
    useEditorLayout.setState({ moveTab: spy });
    const { container } = render(<PaneDropZone workspace="/ws" paneId="pane-1" isActive />);
    const zone = container.querySelector('[data-pane-drop-zone="pane-1"]') as HTMLElement;
    fireEvent(zone, makeDropEvent(50, 50, ""));
    expect(spy).not.toHaveBeenCalled();
    useEditorLayout.setState({ moveTab });
  });

  it("ignores a drop with malformed JSON", () => {
    const moveTab = useEditorLayout.getState().moveTab;
    const spy = vi.fn(moveTab);
    useEditorLayout.setState({ moveTab: spy });
    const { container } = render(<PaneDropZone workspace="/ws" paneId="pane-1" isActive />);
    const zone = container.querySelector('[data-pane-drop-zone="pane-1"]') as HTMLElement;
    fireEvent(zone, makeDropEvent(50, 50, "not-json"));
    expect(spy).not.toHaveBeenCalled();
    useEditorLayout.setState({ moveTab });
  });

  it("ignores a drop whose payload is missing fromPaneId or tabId", () => {
    const moveTab = useEditorLayout.getState().moveTab;
    const spy = vi.fn(moveTab);
    useEditorLayout.setState({ moveTab: spy });
    const { container } = render(<PaneDropZone workspace="/ws" paneId="pane-1" isActive />);
    const zone = container.querySelector('[data-pane-drop-zone="pane-1"]') as HTMLElement;
    fireEvent(zone, makeDropEvent(50, 50, JSON.stringify({ fromPaneId: "" })));
    expect(spy).not.toHaveBeenCalled();
    useEditorLayout.setState({ moveTab });
  });

  it.each([
    ["left", 5, 50],
    ["right", 95, 50],
    ["top", 50, 5],
    ["bottom", 50, 95],
  ])("splits the pane when a tab is dropped on the %s edge", (_label, x, y) => {
    const splitWithTab = useEditorLayout.getState().splitWithTab;
    const spy = vi.fn(splitWithTab);
    useEditorLayout.setState({ splitWithTab: spy });
    const { container } = render(<PaneDropZone workspace="/ws" paneId="pane-1" isActive />);
    const zone = container.querySelector('[data-pane-drop-zone="pane-1"]') as HTMLElement;
    stubRect(zone);
    fireEvent(zone, makeDropEvent(x, y, JSON.stringify({ fromPaneId: "pane-0", tabId: "tab-9" })));
    expect(spy).toHaveBeenCalled();
    useEditorLayout.setState({ splitWithTab });
  });

  it.each([
    ["left", 5, 50, /width: 50%/],
    ["right", 95, 50, /width: 50%/],
    ["top", 50, 5, /height: 50%/],
    ["bottom", 50, 95, /height: 50%/],
    ["center", 50, 50, /inset: 0/],
  ])("renders the %s region hint while hovering", (_label, x, y, styleMatcher) => {
    const { container } = render(<PaneDropZone workspace="/ws" paneId="pane-1" isActive />);
    const zone = container.querySelector('[data-pane-drop-zone="pane-1"]') as HTMLElement;
    stubRect(zone);
    fireEvent(zone, makeDragOverEvent(x, y));
    const span = zone.querySelector("span");
    expect(span).not.toBeNull();
    expect(span?.getAttribute("style") ?? "").toMatch(styleMatcher);
  });
});

function makeDragOverEvent(clientX: number, clientY: number): Event {
  const evt = createEvent.dragOver(document.createElement("div"));
  Object.defineProperty(evt, "clientX", { value: clientX });
  Object.defineProperty(evt, "clientY", { value: clientY });
  Object.defineProperty(evt, "dataTransfer", {
    value: { types: [TAB_DRAG_MIME], dropEffect: "" },
  });
  return evt;
}

function stubRect(zone: HTMLElement) {
  zone.getBoundingClientRect = () =>
    ({
      left: 0,
      top: 0,
      width: 100,
      height: 100,
      right: 100,
      bottom: 100,
      x: 0,
      y: 0,
    }) as DOMRect;
}

function makeDropEvent(clientX: number, clientY: number, payload: string) {
  const evt = createEvent.drop(document.createElement("div"));
  Object.defineProperty(evt, "clientX", { value: clientX });
  Object.defineProperty(evt, "clientY", { value: clientY });
  Object.defineProperty(evt, "dataTransfer", {
    value: { getData: (m: string) => (m === TAB_DRAG_MIME ? payload : "") },
  });
  return evt;
}
