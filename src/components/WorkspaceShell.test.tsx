// S-MWS-003: WorkspaceShell renderer — split + tab strip + leaf body.

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  type WorkspaceTab,
  createTabsNode,
  createWorkspaceTab,
  emptyWindowLayout,
  useWorkspaceLayout,
} from "../store/workspace-layout";
import { WorkspaceShell } from "./WorkspaceShell";

beforeEach(() => {
  useWorkspaceLayout.setState({ layout: null });
});

afterEach(() => {
  cleanup();
});

function renderBody(tab: WorkspaceTab) {
  return <div data-testid={`body-${tab.id}`}>body:{tab.workspacePath}</div>;
}

describe("WorkspaceShell", () => {
  it("renders nothing when no layout exists", () => {
    const { container } = render(<WorkspaceShell renderTabBody={renderBody} />);
    expect(container.querySelector('[data-workspace-shell="true"]')).toBeNull();
  });

  it("renders a single tab strip + active body for a single ws-tabs layout", () => {
    const layout = emptyWindowLayout("/ws-a");
    useWorkspaceLayout.setState({ layout });
    render(<WorkspaceShell renderTabBody={renderBody} />);
    expect(screen.getByText(/body:\/ws-a/)).not.toBeNull();
    const strip = screen.getByRole("tablist");
    expect(strip).not.toBeNull();
    expect(strip.querySelectorAll("[data-ws-tab-id]")).toHaveLength(1);
  });

  it("renders a row split for ws-split horizontal", () => {
    useWorkspaceLayout.setState({ layout: emptyWindowLayout("/ws-a") });
    useWorkspaceLayout.getState().splitVertical();
    render(<WorkspaceShell renderTabBody={renderBody} />);
    const split = document.querySelector('[data-ws-split-direction="horizontal"]');
    expect(split).not.toBeNull();
    // 두 개의 분리된 leaf section.
    expect(document.querySelectorAll("[data-ws-tabs-id]")).toHaveLength(2);
    // Split handle.
    expect(document.querySelectorAll('[role="separator"]')).toHaveLength(1);
  });

  it("renders a column split for ws-split vertical", () => {
    useWorkspaceLayout.setState({ layout: emptyWindowLayout("/ws-a") });
    useWorkspaceLayout.getState().splitHorizontal();
    render(<WorkspaceShell renderTabBody={renderBody} />);
    expect(document.querySelector('[data-ws-split-direction="vertical"]')).not.toBeNull();
  });

  it("activates a tab on click and closes via the × button", () => {
    useWorkspaceLayout.setState({ layout: emptyWindowLayout("/ws-a") });
    useWorkspaceLayout.getState().addWorkspaceTab("/ws-b");
    render(<WorkspaceShell renderTabBody={renderBody} />);
    const tabs = document.querySelectorAll("[data-ws-tab-id]");
    expect(tabs).toHaveLength(2);
    const firstTab = tabs[0] as HTMLElement;
    fireEvent.click(firstTab);
    const firstId = firstTab.getAttribute("data-ws-tab-id") ?? "";
    expect(useWorkspaceLayout.getState().layout?.activeTabId).toBe(firstId);
    // Close via × — find the second tab's close span.
    const secondTab = tabs[1] as HTMLElement;
    const secondId = secondTab.getAttribute("data-ws-tab-id") ?? "";
    const closeBtn = secondTab.querySelector("[data-ws-tab-close]") as HTMLElement;
    fireEvent.click(closeBtn);
    // After close: only one tab remains.
    const remaining = document.querySelectorAll("[data-ws-tab-id]");
    expect(remaining).toHaveLength(1);
    expect(useWorkspaceLayout.getState().layout?.activeTabId).not.toBe(secondId);
  });

  it("close button responds to Enter key", () => {
    useWorkspaceLayout.setState({ layout: emptyWindowLayout("/ws-a") });
    useWorkspaceLayout.getState().addWorkspaceTab("/ws-b");
    render(<WorkspaceShell renderTabBody={renderBody} />);
    const tabs = document.querySelectorAll("[data-ws-tab-id]");
    const closeBtn = (tabs[1] as HTMLElement).querySelector("[data-ws-tab-close]") as HTMLElement;
    fireEvent.keyDown(closeBtn, { key: "Enter" });
    expect(document.querySelectorAll("[data-ws-tab-id]")).toHaveLength(1);
  });

  it("close button responds to Space key", () => {
    useWorkspaceLayout.setState({ layout: emptyWindowLayout("/ws-a") });
    useWorkspaceLayout.getState().addWorkspaceTab("/ws-b");
    render(<WorkspaceShell renderTabBody={renderBody} />);
    const tabs = document.querySelectorAll("[data-ws-tab-id]");
    const closeBtn = (tabs[1] as HTMLElement).querySelector("[data-ws-tab-close]") as HTMLElement;
    fireEvent.keyDown(closeBtn, { key: " " });
    expect(document.querySelectorAll("[data-ws-tab-id]")).toHaveLength(1);
  });

  it("close button ignores other keys", () => {
    useWorkspaceLayout.setState({ layout: emptyWindowLayout("/ws-a") });
    useWorkspaceLayout.getState().addWorkspaceTab("/ws-b");
    render(<WorkspaceShell renderTabBody={renderBody} />);
    const tabs = document.querySelectorAll("[data-ws-tab-id]");
    const closeBtn = (tabs[1] as HTMLElement).querySelector("[data-ws-tab-close]") as HTMLElement;
    fireEvent.keyDown(closeBtn, { key: "x" });
    expect(document.querySelectorAll("[data-ws-tab-id]")).toHaveLength(2);
  });

  it("fast path: handcrafted activeTabId stays on the first tab when mismatched", () => {
    // 직접 layout 을 만들어 activeTabId 가 ws-tabs 노드의 activeTabId 와
    // 일관되지 않은 케이스를 시뮬레이션 (정상 동작 시 fallback).
    const t1 = createWorkspaceTab("/x");
    const t2 = createWorkspaceTab("/y");
    const node = createTabsNode([t1, t2], t1.id);
    useWorkspaceLayout.setState({
      layout: { schemaVersion: 2, root: node, activeTabId: t1.id },
    });
    // 강제로 node.activeTabId 만 다른 id 로 (defensive fallback 트리거).
    useWorkspaceLayout.setState({
      layout: {
        schemaVersion: 2,
        root: { ...node, activeTabId: "missing" },
        activeTabId: t1.id,
      },
    });
    render(<WorkspaceShell renderTabBody={renderBody} />);
    // node.tabs[0] 가 fallback 으로 활성 — 본문에 t1 의 경로가 보여야 함.
    expect(screen.getByText(/body:\/x/)).not.toBeNull();
  });

  it("activates a tab via Enter/Space keyboard on the tab itself", () => {
    useWorkspaceLayout.setState({ layout: emptyWindowLayout("/ws-a") });
    useWorkspaceLayout.getState().addWorkspaceTab("/ws-b");
    render(<WorkspaceShell renderTabBody={renderBody} />);
    const tabs = document.querySelectorAll("[data-ws-tab-id]");
    const firstTab = tabs[0] as HTMLElement;
    const firstId = firstTab.getAttribute("data-ws-tab-id") ?? "";
    // Enter 로 활성화.
    fireEvent.keyDown(firstTab, { key: "Enter" });
    expect(useWorkspaceLayout.getState().layout?.activeTabId).toBe(firstId);
    // 다른 탭으로 이동 후 Space 로 활성화.
    const secondTab = tabs[1] as HTMLElement;
    const secondId = secondTab.getAttribute("data-ws-tab-id") ?? "";
    fireEvent.keyDown(secondTab, { key: " " });
    expect(useWorkspaceLayout.getState().layout?.activeTabId).toBe(secondId);
    // 다른 키는 무시됨.
    fireEvent.keyDown(firstTab, { key: "x" });
    expect(useWorkspaceLayout.getState().layout?.activeTabId).toBe(secondId);
  });

  it("renders deeply nested splits without crashing", () => {
    useWorkspaceLayout.setState({ layout: emptyWindowLayout("/ws-a") });
    useWorkspaceLayout.getState().splitVertical();
    // active 는 새로 생성된 클론 — 다시 split.
    useWorkspaceLayout.getState().splitHorizontal();
    render(<WorkspaceShell renderTabBody={renderBody} />);
    expect(document.querySelectorAll("[data-ws-tabs-id]").length).toBeGreaterThanOrEqual(3);
  });
});
