// @vitest-environment jsdom
// FIX 검증: ChatShell + ContextPanel 에서 파일 트리 → 실제 표시 + 클릭 → 에디터 영역 활성.

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

// Mock heavy AgentPicker / acp adapter
vi.mock("../../components/AgentPicker", () => ({
  AgentPicker: () => null,
}));
vi.mock("../../components/ToolDiffDialog", () => ({
  ToolDiffDialog: () => null,
}));
vi.mock("../../lib/agents/acp-adapter", () => ({
  getAcpAdapter: () => ({
    listAgents: vi.fn(async () => []),
    sendMessage: vi.fn(),
  }),
}));

import { useChatSessions } from "../../store/chat-sessions";
import { useFileTree } from "../../store/file-tree";
import { useLayout } from "../../store/layout";
import { useTabs } from "../../store/tabs";
import { useWorkspace } from "../../store/workspace";
import { ChatShell } from "../ChatShell";

const WS = "/ws";

const LISTING = [
  { name: "README.md", path: `${WS}/README.md`, is_dir: false, modified_ms: 1 },
  { name: "package.json", path: `${WS}/package.json`, is_dir: false, modified_ms: 2 },
  { name: "src", path: `${WS}/src`, is_dir: true, modified_ms: 3 },
];

beforeEach(() => {
  invokeMock.mockReset();
  invokeMock.mockImplementation((cmd: string) => {
    if (cmd === "fs_list_dir")
      return Promise.resolve({ entries: LISTING, page: 0, has_more: false });
    if (cmd === "fs_check_locked") return Promise.resolve(false);
    if (cmd === "fs_stat") return Promise.reject("not found");
    if (cmd === "fs_read_file") return Promise.resolve({ content: "# hello", encoding: "utf-8" });
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
    mdOnly: { [WS]: false }, // 전체 보기로 비-md 파일도 확인
  } as never);
});

afterEach(cleanup);

describe("ChatShell — ContextPanel FileTree 통합 (FIX)", () => {
  it("FileTree 가 ChatShell 의 ContextPanel 안에 실제 렌더됨 (stub 아님)", async () => {
    render(<ChatShell />);
    await waitFor(() => expect(screen.getAllByText("README.md").length).toBeGreaterThan(0));
    // 이전 버그: "File tree wired in U2" stub 메시지
    expect(screen.queryByText(/wired in U2/)).toBeNull();
    expect(screen.getByText("README.md")).toBeTruthy();
    expect(screen.getByText("src")).toBeTruthy();
  });

  it("파일 클릭 → useTabs.activePath 변경 → chat-editor-region 렌더", async () => {
    render(<ChatShell />);
    await waitFor(() => expect(screen.getByText("README.md")).toBeTruthy());

    // 파일 클릭
    fireEvent.click(screen.getByText("README.md"));

    // useTabs 가 업데이트됨
    await waitFor(() => expect(useTabs.getState().activePath).toBe(`${WS}/README.md`));
    // EditorPane 이 ChatShell 의 chat-editor-region 안에 나타남
    await waitFor(() => expect(screen.getByTestId("chat-editor-region")).toBeTruthy());
    // chat-stream 도 여전히 아래에 보임
    expect(screen.getByTestId("chat-stream-bottom")).toBeTruthy();
  });

  it("초기 (파일 선택 없음) = chat-stream 만 보임, 에디터 영역 없음", async () => {
    render(<ChatShell />);
    await waitFor(() => expect(screen.getByText("README.md")).toBeTruthy());
    expect(screen.queryByTestId("chat-editor-region")).toBeNull();
    expect(screen.queryByTestId("chat-stream-bottom")).toBeNull();
    // ChatStream is shown full-screen
    expect(screen.getByTestId("chat-stream-region")).toBeTruthy();
  });
});
