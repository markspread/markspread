// @vitest-environment jsdom
// FIX 검증: ChatShell 에서 .md 파일 클릭 시 chat-preview-region 이 렌더됨.

import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

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

const invokeMock = vi.fn();
vi.mock("@tauri-apps/api/core", () => ({
  invoke: (cmd: string, args?: unknown) => invokeMock(cmd, args),
}));
vi.mock("@tauri-apps/api/event", () => ({
  listen: () => Promise.resolve(() => {}),
}));
vi.mock("../../components/AgentPicker", () => ({ AgentPicker: () => null }));
vi.mock("../../components/ToolDiffDialog", () => ({ ToolDiffDialog: () => null }));
vi.mock("../../lib/agents/acp-adapter", () => ({
  getAcpAdapter: () => ({ listAgents: vi.fn(async () => []), sendMessage: vi.fn() }),
}));
// Stub SpreadPane (heavy) — we just need to assert it gets mounted with right props.
vi.mock("../../components/SpreadPane", () => ({
  SpreadPane: ({ documentPath, content }: { documentPath: string; content: string }) => (
    <div data-testid="spread-pane-stub" data-doc={documentPath}>
      content-len:{content.length}
    </div>
  ),
}));

import { useChatSessions } from "../../store/chat-sessions";
import { useFileTree } from "../../store/file-tree";
import { useLayout } from "../../store/layout";
import { useTabs } from "../../store/tabs";
import { useWorkspace } from "../../store/workspace";
import { ChatShell } from "../ChatShell";

const WS = "/ws";

beforeEach(() => {
  invokeMock.mockReset();
  invokeMock.mockImplementation((cmd: string) => {
    if (cmd === "fs_list_dir")
      return Promise.resolve({
        entries: [
          { name: "README.md", path: `${WS}/README.md`, is_dir: false, modified_ms: 1 },
          { name: "data.json", path: `${WS}/data.json`, is_dir: false, modified_ms: 2 },
        ],
        page: 0,
        has_more: false,
      });
    if (cmd === "fs_check_locked") return Promise.resolve(false);
    if (cmd === "fs_stat") return Promise.reject("not found");
    if (cmd === "fs_read_file")
      return Promise.resolve({ content: "# Hello\n\nWorld", encoding: "utf-8" });
    return Promise.resolve(undefined);
  });
  useWorkspace.setState({ current: WS, preferredShell: "chat" } as never);
  useChatSessions.setState({ sessions: {}, byWorkspace: {}, activeSessionId: null } as never);
  useFileTree.setState({ splits: {} });
  useTabs.setState({ tabs: [], activePath: null });
  useLayout.setState({
    sortMode: {},
    foldersFirst: {},
    showHidden: {},
    mdOnly: { [WS]: false },
  } as never);
});

afterEach(cleanup);

describe("ChatShell md preview (FIX: 미리보기 안 보이던 버그)", () => {
  it(".md 파일 클릭 → chat-preview-region 이 mount (SpreadPane wrap)", async () => {
    render(<ChatShell />);
    await waitFor(() => expect(screen.getByText("README.md")).toBeTruthy());
    fireEvent.click(screen.getByText("README.md"));
    await waitFor(() => expect(useTabs.getState().activePath).toBe(`${WS}/README.md`));
    await waitFor(() => expect(screen.getByTestId("chat-preview-region")).toBeTruthy());
    // ChatPreview 가 fs_read_file 호출 + SpreadPane 마운트
    await waitFor(() => expect(screen.getByTestId("spread-pane-stub")).toBeTruthy());
    expect(screen.getByTestId("spread-pane-stub").dataset.doc).toBe(`${WS}/README.md`);
  });

  it("비-md 파일 클릭 → chat-preview-region 없음 (에디터만)", async () => {
    render(<ChatShell />);
    await waitFor(() => expect(screen.getByText("data.json")).toBeTruthy());
    fireEvent.click(screen.getByText("data.json"));
    await waitFor(() => expect(useTabs.getState().activePath).toBe(`${WS}/data.json`));
    await waitFor(() => expect(screen.getByTestId("chat-editor-region")).toBeTruthy());
    expect(screen.queryByTestId("chat-preview-region")).toBeNull();
  });

  it("ChatPreview 가 fs_read_file 호출 (workspace + path 함께)", async () => {
    render(<ChatShell />);
    await waitFor(() => expect(screen.getByText("README.md")).toBeTruthy());
    fireEvent.click(screen.getByText("README.md"));
    await waitFor(() =>
      expect(invokeMock).toHaveBeenCalledWith("fs_read_file", {
        workspace: WS,
        path: `${WS}/README.md`,
      }),
    );
  });
});
