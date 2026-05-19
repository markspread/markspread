import { cleanup, render, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { PaneNode } from "../lib/editor/layout-model";

vi.mock("@tauri-apps/api/core", () => ({
  invoke: () => Promise.resolve(undefined),
}));
vi.mock("../lib/preview/render", () => ({
  createDebouncedRenderer: () => (content: string) => Promise.resolve(`<p>${content}</p>`),
}));
vi.mock("../lib/preview/shiki", () => ({ highlightCode: (c: string) => Promise.resolve(c) }));
vi.mock("../lib/preview/codeCopyButton", () => ({ attachCodeCopyButtons: () => {} }));
vi.mock("../lib/preview/checkboxToggle", () => ({ attachCheckboxToggles: () => {} }));
vi.mock("../lib/preview/linkClick", () => ({ attachLinkClickHandler: () => () => {} }));
vi.mock("../lib/preview/mermaid", () => ({ renderMermaidIn: () => Promise.resolve() }));
vi.mock("../lib/preview/katex", () => ({ renderMathIn: () => Promise.resolve() }));
vi.mock("../lib/preview/scrollSync", () => ({
  emitScroll: () => {},
  onScroll: () => () => {},
  isScrollSyncEnabled: () => false,
  suppressEcho: () => {},
}));
vi.mock("../lib/parsers/registry", () => ({
  BUILTIN_MARKDOWN_ID: "builtin",
  getParserRegistry: () => ({ match: () => null }),
}));
vi.mock("../lib/parsers/transport-registry", () => ({
  getParserTransport: () => null,
}));

import { SpreadPane } from "./SpreadPane";

afterEach(cleanup);

const pane: PaneNode = { type: "pane", id: "pane-1", tabs: [], activeTabId: null };

describe("SpreadPane", () => {
  it("renders the preview region", () => {
    const { container } = render(
      <SpreadPane workspace="/ws" pane={pane} documentPath="/ws/a.md" content="# hi" />,
    );
    expect(container.querySelector('[data-spread-pane="pane-1"]')).not.toBeNull();
  });

  it("renders the debounced markdown HTML", async () => {
    const { container } = render(
      <SpreadPane workspace="/ws" pane={pane} documentPath="/ws/a.md" content="hello world" />,
    );
    await waitFor(() => expect(container.innerHTML).toContain("<p>hello world</p>"));
  });
});
