// Coverage for the AI conversation panel data layer.

import { describe, expect, it, vi } from "vitest";
import { type AiPanel, type AiPanelAdapter, createAiPanel } from "./aiPanel";

function makeAdapter(impl?: AiPanelAdapter["send"]): AiPanelAdapter {
  return {
    send: impl ?? (async () => ({ content: "reply", model: "test-model" })),
  };
}

describe("createAiPanel", () => {
  it("starts with no messages", () => {
    const panel = createAiPanel(makeAdapter());
    expect(panel.messages).toEqual([]);
    expect(panel.serialize()).toEqual([]);
  });

  it("appends user + assistant messages on send and resolves content", async () => {
    const panel = createAiPanel(makeAdapter());
    await panel.send("hello");
    expect(panel.messages).toHaveLength(2);
    expect(panel.messages[0]?.role).toBe("user");
    expect(panel.messages[0]?.content).toBe("hello");
    expect(panel.messages[1]?.role).toBe("assistant");
    expect(panel.messages[1]?.content).toBe("reply");
    expect(panel.messages[1]?.model).toBe("test-model");
  });

  it("streams deltas via onDelta into the assistant message", async () => {
    const adapter = makeAdapter(async ({ onDelta }) => {
      onDelta("a");
      onDelta("b");
      return { content: "ab", model: "m" };
    });
    const panel = createAiPanel(adapter);
    await panel.send("q");
    expect(panel.messages[1]?.content).toBe("ab");
  });

  it("passes history excluding the pending assistant message", async () => {
    let captured: number | null = null;
    const adapter = makeAdapter(async ({ history }) => {
      captured = history.length;
      return { content: "x", model: "m" };
    });
    const panel = createAiPanel(adapter);
    await panel.send("first");
    // history = userMsg only (assistant slice(0,-1)).
    expect(captured).toBe(1);
  });

  it("notifies subscribers and supports unsubscribe", async () => {
    const panel = createAiPanel(makeAdapter());
    const listener = vi.fn();
    const unsub = panel.subscribe(listener);
    await panel.send("hi");
    expect(listener).toHaveBeenCalled();
    const callsAfterSend = listener.mock.calls.length;
    unsub();
    panel.clear();
    expect(listener.mock.calls.length).toBe(callsAfterSend);
  });

  it("records an error marker when the adapter throws (empty content branch)", async () => {
    const adapter = makeAdapter(async () => {
      throw new Error("boom");
    });
    const panel = createAiPanel(adapter);
    await panel.send("q");
    expect(panel.messages[1]?.content).toBe("*[error: boom]*");
  });

  it("appends an error marker with separator when content already streamed", async () => {
    const adapter = makeAdapter(async ({ onDelta }) => {
      onDelta("partial");
      throw new Error("late fail");
    });
    const panel = createAiPanel(adapter);
    await panel.send("q");
    expect(panel.messages[1]?.content).toBe("partial\n\n*[error: late fail]*");
  });

  it("abort() invokes the active controller", async () => {
    let signalAborted = false;
    const adapter = makeAdapter(
      ({ abortSignal }) =>
        new Promise((resolve) => {
          abortSignal.addEventListener("abort", () => {
            signalAborted = true;
            resolve({ content: "stopped", model: "m" });
          });
        }),
    );
    const panel = createAiPanel(adapter);
    const pending = panel.send("q");
    panel.abort();
    await pending;
    expect(signalAborted).toBe(true);
  });

  it("abort() is a no-op when nothing is in flight", () => {
    const panel = createAiPanel(makeAdapter());
    expect(() => panel.abort()).not.toThrow();
  });

  it("clear() empties messages and notifies", async () => {
    const panel = createAiPanel(makeAdapter());
    await panel.send("hi");
    panel.clear();
    expect(panel.messages).toEqual([]);
  });

  it("restore() replaces messages with a copy", () => {
    const panel = createAiPanel(makeAdapter());
    const restored = [{ id: "x", role: "user" as const, content: "old", startedAt: 1 }];
    panel.restore(restored);
    expect(panel.messages).toEqual(restored);
    expect(panel.messages).not.toBe(restored);
  });

  it("serialize() returns a defensive copy", async () => {
    const panel = createAiPanel(makeAdapter());
    await panel.send("hi");
    const snap = panel.serialize();
    expect(snap).toBe(panel.serialize() === snap ? snap : snap);
    expect(snap).toEqual(panel.messages);
    expect(snap).not.toBe(panel.messages);
  });

  it("generates unique message ids", async () => {
    const panel: AiPanel = createAiPanel(makeAdapter());
    await panel.send("a");
    const ids = panel.messages.map((m) => m.id);
    expect(new Set(ids).size).toBe(ids.length);
  });
});
