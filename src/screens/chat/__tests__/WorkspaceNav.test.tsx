// @vitest-environment jsdom
import { cleanup, fireEvent, render } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { WorkspaceNav } from "../WorkspaceNav";

afterEach(cleanup);

const session = (id: string, title = "Chat") => ({
  id,
  workspaceId: "ws1",
  title,
  createdAt: 0,
  updatedAt: 0,
  messages: [],
});

describe("WorkspaceNav", () => {
  it("renders sessions and triggers onSelect when clicked", () => {
    const onSelect = vi.fn();
    const { getByTestId } = render(
      <WorkspaceNav
        workspaceId="/ws"
        sessions={[session("a", "First"), session("b", "Second")]}
        activeSessionId="a"
        onSelect={onSelect}
        onNew={() => {}}
      />,
    );
    fireEvent.click(getByTestId("chat-session-b"));
    expect(onSelect).toHaveBeenCalledWith("b");
  });

  it("marks the active session via data-active", () => {
    const { getByTestId } = render(
      <WorkspaceNav
        workspaceId="/ws"
        sessions={[session("a"), session("b")]}
        activeSessionId="b"
        onSelect={() => {}}
        onNew={() => {}}
      />,
    );
    expect(getByTestId("chat-session-a").getAttribute("data-active")).toBe("false");
    expect(getByTestId("chat-session-b").getAttribute("data-active")).toBe("true");
  });

  it("triggers onNew when the new-chat button is clicked", () => {
    const onNew = vi.fn();
    const { getByTestId } = render(
      <WorkspaceNav
        workspaceId="/ws"
        sessions={[]}
        activeSessionId={null}
        onSelect={() => {}}
        onNew={onNew}
      />,
    );
    fireEvent.click(getByTestId("chat-new-session"));
    expect(onNew).toHaveBeenCalled();
  });

  it("renders a placeholder workspace label when workspaceId is empty", () => {
    const { container } = render(
      <WorkspaceNav
        workspaceId=""
        sessions={[]}
        activeSessionId={null}
        onSelect={() => {}}
        onNew={() => {}}
      />,
    );
    expect(container.textContent).toContain("(none)");
  });
});
