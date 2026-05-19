import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { EditorPosition, OpenTab } from "../store/tabs";
import { useTabs } from "../store/tabs";
import { TabBar } from "./TabBar";

afterEach(cleanup);

const POS: EditorPosition = { line: 0, column: 0, scrollTop: 0 };

function tab(path: string, extra: Partial<OpenTab> = {}): OpenTab {
  return { path, position: POS, ...extra };
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
});
