// @vitest-environment jsdom
import { cleanup, fireEvent, render } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

if (typeof Element !== "undefined" && !Element.prototype.scrollIntoView) {
  Element.prototype.scrollIntoView = () => {};
}
if (typeof globalThis.ResizeObserver === "undefined") {
  class FakeRO {
    observe() {}
    unobserve() {}
    disconnect() {}
  }
  (globalThis as unknown as { ResizeObserver: typeof FakeRO }).ResizeObserver = FakeRO;
}

// FileTree 가 Tauri invoke 를 호출하므로 mock 필요.
vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn(async (cmd: string) => {
    if (cmd === "fs_list_dir") return { entries: [], page: 0, has_more: false };
    if (cmd === "fs_check_locked") return false;
    return undefined;
  }),
}));
vi.mock("@tauri-apps/api/event", () => ({
  listen: () => Promise.resolve(() => {}),
}));

import { ContextPanel } from "../ContextPanel";

afterEach(cleanup);

describe("ContextPanel", () => {
  it("renders the FileTree component when a workspace is set", () => {
    const { getByTestId } = render(
      <ContextPanel workspaceId="/ws" activeFilePath={null} onPickFile={() => {}} />,
    );
    // ContextPanel 의 chat-file-tree section 이 존재
    expect(getByTestId("chat-file-tree")).toBeTruthy();
    // Files 헤더 + FileTree 내부 toolbar 가 렌더됨 (md-only 토글 버튼 포함)
    expect(getByTestId("chat-file-tree").textContent).toContain("Files");
  });

  it("renders the no-workspace caption when workspaceId is empty", () => {
    const { getByTestId } = render(
      <ContextPanel workspaceId="" activeFilePath={null} onPickFile={() => {}} />,
    );
    expect(getByTestId("chat-file-tree").textContent).toContain("no workspace");
  });

  it("shows the active preview when activeFilePath is set + clear button works", () => {
    const onPick = vi.fn();
    const { getByTestId } = render(
      <ContextPanel workspaceId="/ws" activeFilePath="a.md" onPickFile={onPick} />,
    );
    expect(getByTestId("chat-active-preview").textContent).toContain("a.md");
    fireEvent.click(getByTestId("chat-clear-active-file"));
    expect(onPick).toHaveBeenCalledWith(null);
  });

  it("renders 'No file selected' italic when no activeFilePath", () => {
    const { getByTestId } = render(
      <ContextPanel workspaceId="/ws" activeFilePath={null} onPickFile={() => {}} />,
    );
    expect(getByTestId("chat-active-preview").textContent).toContain("No file selected");
  });

  it("token gauge shows 0 / budget when the pack is empty (workspaceId only)", () => {
    const { getByTestId } = render(
      <ContextPanel workspaceId="/ws" activeFilePath={null} onPickFile={() => {}} />,
    );
    const gauge = getByTestId("chat-token-gauge");
    expect(gauge.textContent).toMatch(/\d+ \/ \d+/);
  });
});
