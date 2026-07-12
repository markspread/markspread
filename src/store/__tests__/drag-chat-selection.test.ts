// ADR-0014 H13: drag-chat-selection store 테스트.

import { beforeEach, describe, expect, it } from "vitest";
import { useDragChatSelection } from "../drag-chat-selection";

beforeEach(() => {
  useDragChatSelection.setState({ current: null, raw: null, screenPosition: null });
});

describe("useDragChatSelection", () => {
  it("starts with no selection", () => {
    expect(useDragChatSelection.getState().current).toBeNull();
  });

  it("capture() builds SelectionContext + stores", () => {
    useDragChatSelection.getState().capture({
      filePath: "/ws/doc.md",
      fullText: "abc DEF ghi",
      fromOffset: 4,
      toOffset: 7,
    });
    const sel = useDragChatSelection.getState().current;
    expect(sel).not.toBeNull();
    expect(sel?.selectedText).toBe("DEF");
    expect(sel?.filePath).toBe("/ws/doc.md");
  });

  it("capture() ignores empty selection (from === to)", () => {
    useDragChatSelection.getState().capture({
      filePath: "/ws/doc.md",
      fullText: "abc",
      fromOffset: 1,
      toOffset: 1,
    });
    expect(useDragChatSelection.getState().current).toBeNull();
  });

  it("clear() resets to null", () => {
    useDragChatSelection.getState().capture({
      filePath: "/ws/doc.md",
      fullText: "abc",
      fromOffset: 0,
      toOffset: 3,
    });
    expect(useDragChatSelection.getState().current).not.toBeNull();
    useDragChatSelection.getState().clear();
    expect(useDragChatSelection.getState().current).toBeNull();
  });

  it("capture() keeps the raw range so accept can splice by offsets", () => {
    useDragChatSelection.getState().capture({
      filePath: "/ws/doc.md",
      fullText: "abc DEF ghi",
      fromOffset: 4,
      toOffset: 7,
    });
    const raw = useDragChatSelection.getState().raw;
    expect(raw).toEqual({ fullText: "abc DEF ghi", fromOffset: 4, toOffset: 7 });
  });

  it("capture() stores the selection screen position when provided", () => {
    useDragChatSelection.getState().capture({
      filePath: "/ws/doc.md",
      fullText: "abc",
      fromOffset: 0,
      toOffset: 3,
      screenPosition: { top: 120, left: 40 },
    });
    expect(useDragChatSelection.getState().screenPosition).toEqual({ top: 120, left: 40 });
  });

  it("capture() without coordinates leaves screenPosition null", () => {
    useDragChatSelection.getState().capture({
      filePath: "/ws/doc.md",
      fullText: "abc",
      fromOffset: 0,
      toOffset: 3,
    });
    expect(useDragChatSelection.getState().screenPosition).toBeNull();
  });

  it("clear() also resets raw + screenPosition", () => {
    useDragChatSelection.getState().capture({
      filePath: "/ws/doc.md",
      fullText: "abc",
      fromOffset: 0,
      toOffset: 3,
      screenPosition: { top: 1, left: 2 },
    });
    useDragChatSelection.getState().clear();
    const s = useDragChatSelection.getState();
    expect(s.current).toBeNull();
    expect(s.raw).toBeNull();
    expect(s.screenPosition).toBeNull();
  });

  it("subsequent captures overwrite previous", () => {
    useDragChatSelection.getState().capture({
      filePath: "/a",
      fullText: "abc",
      fromOffset: 0,
      toOffset: 2,
    });
    useDragChatSelection.getState().capture({
      filePath: "/b",
      fullText: "xyz",
      fromOffset: 1,
      toOffset: 3,
    });
    const sel = useDragChatSelection.getState().current;
    expect(sel?.filePath).toBe("/b");
    expect(sel?.selectedText).toBe("yz");
  });
});
