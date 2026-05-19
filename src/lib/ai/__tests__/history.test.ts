// S-AI-029 / S-AI-030: action history coverage.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const invokeMock = vi.fn();
vi.mock("@tauri-apps/api/core", () => ({
  invoke: (...args: unknown[]) => invokeMock(...args),
}));

import { type AiHistoryRecord, listHistory, recordHistory, replayPrompt } from "../history";

const record: AiHistoryRecord = {
  id: "h1",
  createdAt: 1_700_000_000_000,
  actionId: "summarize",
  label: "Summarize",
  prompt: "Summarize this:\n---\nold body\n---",
  model: "claude-sonnet-4-6",
  response: "a summary",
  inputTokens: 100,
  outputTokens: 30,
  usdCost: 0.001,
  durationMs: 1200,
};

beforeEach(() => invokeMock.mockReset());
afterEach(() => invokeMock.mockReset());

describe("recordHistory", () => {
  it("invokes ai_history_record with the record", async () => {
    invokeMock.mockResolvedValueOnce(undefined);
    await recordHistory(record);
    expect(invokeMock).toHaveBeenCalledWith("ai_history_record", { record });
  });
});

describe("listHistory", () => {
  it("invokes ai_history_list with the default limit", async () => {
    invokeMock.mockResolvedValueOnce([record]);
    const out = await listHistory();
    expect(invokeMock).toHaveBeenCalledWith("ai_history_list", { limit: 100 });
    expect(out).toHaveLength(1);
  });

  it("forwards an explicit limit", async () => {
    invokeMock.mockResolvedValueOnce([]);
    await listHistory(10);
    expect(invokeMock).toHaveBeenCalledWith("ai_history_list", { limit: 10 });
  });
});

describe("replayPrompt", () => {
  it("substitutes the full document when there is no selection", () => {
    const out = replayPrompt(record, { doc: "new body", selection: null });
    expect(out).toContain("new body");
    expect(out).not.toContain("old body");
  });

  it("substitutes the selection when one is supplied", () => {
    const out = replayPrompt(record, { doc: "new body", selection: "just this" });
    expect(out).toContain("just this");
    expect(out).not.toContain("old body");
  });

  it("keeps the leading instruction", () => {
    const out = replayPrompt(record, { doc: "x", selection: null });
    expect(out.startsWith("Summarize this:")).toBe(true);
  });
});
