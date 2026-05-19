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
    const payload = JSON.stringify({ fromPaneId: "pane-0", tabId: "tab-9" });
    const dropEvent = createEvent.drop(zone);
    Object.defineProperty(dropEvent, "clientX", { value: 50 });
    Object.defineProperty(dropEvent, "clientY", { value: 50 });
    Object.defineProperty(dropEvent, "dataTransfer", {
      value: { getData: (m: string) => (m === TAB_DRAG_MIME ? payload : "") },
    });
    fireEvent(zone, dropEvent);
    expect(spy).toHaveBeenCalled();
    useEditorLayout.setState({ moveTab });
  });
});
