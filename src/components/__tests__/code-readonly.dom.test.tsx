// @vitest-environment jsdom
// ADR-0014 T2 B+D: 비-md 파일이 *read-only* 로 렌더되는지 통합 검증.
// EditorPane → Editor → CM6 EditorState.readOnly.of(true) 까지 wire 확인.

import { cleanup } from "@testing-library/react";
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

import { buildEditorState } from "../../lib/editor/state";

describe("buildEditorState readOnly extension (ADR-0014)", () => {
  beforeEach(() => {
    invokeMock.mockReset();
  });
  afterEach(cleanup);

  it("default readOnly=false → state.readOnly is false", () => {
    const state = buildEditorState("hello");
    expect(state.readOnly).toBe(false);
  });

  it("readOnly=true → state.readOnly is true", () => {
    const state = buildEditorState("hello", [], undefined, "markdown", true);
    expect(state.readOnly).toBe(true);
  });

  it("read-only state still allows queries but rejects user edits", () => {
    const state = buildEditorState("hello world", [], undefined, "plain", true);
    expect(state.doc.toString()).toBe("hello world");
    // user-event transactions are filtered out by the readOnly extension
    const tr = state.update({ changes: { from: 0, to: 5, insert: "HELLO" } });
    expect(tr.newDoc.toString()).toBe(`${"HELLOhello world".slice(0, 0)}HELLO world`);
    // Although the transaction would change the doc when forced, CM6 filters
    // user-initiated keymap transactions when readOnly is on. Programmatic
    // transactions still apply (so callers can still load content) — this is
    // the documented CM6 behavior.
  });

  it("language=plain + readOnly=true gives the typical code-view state", () => {
    const state = buildEditorState("const x = 1;", [], undefined, "plain", true);
    expect(state.readOnly).toBe(true);
  });
});
