// @vitest-environment jsdom
// ADR-0014 T2.g: md-only mode 의 *통합* 동작 검증.
// FileTree 컴포넌트에서 토글 클릭 → 비-md 파일 숨김/표시 까지 end-to-end.

import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

if (typeof Element !== "undefined" && !Element.prototype.scrollIntoView) {
  Element.prototype.scrollIntoView = function scrollIntoView() {};
}
if (typeof globalThis.ResizeObserver === "undefined") {
  class FakeRO {
    observe() {}
    unobserve() {}
    disconnect() {}
  }
  (globalThis as unknown as { ResizeObserver: typeof FakeRO }).ResizeObserver = FakeRO;
}

const invokeMock = vi.fn<(cmd: string, args?: unknown) => Promise<unknown>>();
const unlistenMock = vi.fn();

vi.mock("@tauri-apps/api/core", () => ({
  invoke: (cmd: string, args?: unknown) => invokeMock(cmd, args),
}));

vi.mock("@tauri-apps/api/event", () => ({
  listen: vi.fn(async (_event: string, _handler: (e: unknown) => void) => unlistenMock),
}));

vi.mock("../Icon", () => ({
  Icon: ({ name }: { name: string }) => <span data-testid={`icon-${name}`} />,
}));

import { useFileTree } from "../../store/file-tree";
import { useLayout } from "../../store/layout";
import { useTabs } from "../../store/tabs";
import { FileTree } from "../FileTree";

interface DirEntry {
  name: string;
  path: string;
  is_dir: boolean;
  modified_ms?: number;
}

const ROOT = "/ws";

const ROOT_LISTING: DirEntry[] = [
  { name: "README.md", path: `${ROOT}/README.md`, is_dir: false, modified_ms: 1 },
  { name: "package.json", path: `${ROOT}/package.json`, is_dir: false, modified_ms: 2 },
  { name: "src", path: `${ROOT}/src`, is_dir: true, modified_ms: 3 },
  { name: "tsconfig.json", path: `${ROOT}/tsconfig.json`, is_dir: false, modified_ms: 4 },
  { name: "notes.mdx", path: `${ROOT}/notes.mdx`, is_dir: false, modified_ms: 5 },
];

function defaultInvoke(cmd: string, _args?: unknown): Promise<unknown> {
  if (cmd === "fs_list_dir")
    return Promise.resolve({ entries: ROOT_LISTING, page: 0, has_more: false });
  if (cmd === "fs_check_locked") return Promise.resolve(false);
  if (cmd === "fs_stat") return Promise.reject("not found");
  return Promise.resolve(undefined);
}

function resetStores() {
  useFileTree.setState({ splits: {} });
  useTabs.setState({ tabs: [], activePath: null });
  useLayout.setState({
    sortMode: {},
    foldersFirst: {},
    showHidden: {},
    mdOnly: {}, // 기본은 ON
  } as never);
}

beforeEach(() => {
  invokeMock.mockReset();
  invokeMock.mockImplementation(defaultInvoke);
  unlistenMock.mockReset();
  resetStores();
});

afterEach(cleanup);

describe("md-only mode — FileTree 통합", () => {
  it("기본 모드에서 비-md 파일 (package.json, tsconfig.json) 숨김", async () => {
    render(<FileTree workspace={ROOT} />);
    await waitFor(() => expect(screen.getAllByText("README.md").length).toBeGreaterThan(0));

    // md 파일은 보임
    expect(screen.getByText("README.md")).toBeTruthy();
    expect(screen.getByText("notes.mdx")).toBeTruthy();
    // 폴더는 모드 무관 보임
    expect(screen.getByText("src")).toBeTruthy();
    // 비-md 는 숨김
    expect(screen.queryByText("package.json")).toBeNull();
    expect(screen.queryByText("tsconfig.json")).toBeNull();
  });

  it("토글 후 전체 보기 = 비-md 파일도 보임", async () => {
    render(<FileTree workspace={ROOT} />);
    await waitFor(() => expect(screen.getAllByText("README.md").length).toBeGreaterThan(0));

    const toggle = screen.getByLabelText("md-only mode toggle");
    fireEvent.click(toggle);

    await waitFor(() => expect(screen.getByText("package.json")).toBeTruthy());
    expect(screen.getByText("tsconfig.json")).toBeTruthy();
    expect(screen.getByText("README.md")).toBeTruthy();
  });

  it("toggle 상태가 workspace 단위 persist 됨", async () => {
    expect(useLayout.getState().isMdOnly(ROOT)).toBe(true);
    render(<FileTree workspace={ROOT} />);
    await waitFor(() => expect(screen.getAllByText("README.md").length).toBeGreaterThan(0));

    fireEvent.click(screen.getByLabelText("md-only mode toggle"));
    expect(useLayout.getState().isMdOnly(ROOT)).toBe(false);

    fireEvent.click(screen.getByLabelText("md-only mode toggle"));
    expect(useLayout.getState().isMdOnly(ROOT)).toBe(true);
  });

  it("다른 workspace 는 독립적 상태", async () => {
    useLayout.getState().setMdOnly("/other", false);
    expect(useLayout.getState().isMdOnly(ROOT)).toBe(true);
    expect(useLayout.getState().isMdOnly("/other")).toBe(false);
  });
});
