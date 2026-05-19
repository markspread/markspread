// S-AI-028: concurrent action queue coverage.

import { beforeEach, describe, expect, it } from "vitest";
import { useAiQueue } from "../queue";

beforeEach(() => {
  useAiQueue.setState({ items: [] });
});

function enqueueOne(id: string): void {
  useAiQueue.getState().enqueue({ id, actionId: "summarize", label: "Summarize" });
}

describe("useAiQueue", () => {
  it("enqueue adds a pending item", () => {
    enqueueOne("a");
    const items = useAiQueue.getState().items;
    expect(items).toHaveLength(1);
    expect(items[0]?.status).toBe("pending");
    expect(items[0]?.enqueuedAt).toBeGreaterThan(0);
  });

  it("start marks an item running with a startedAt", () => {
    enqueueOne("a");
    useAiQueue.getState().start("a");
    const item = useAiQueue.getState().items[0];
    expect(item?.status).toBe("running");
    expect(item?.startedAt).toBeGreaterThan(0);
  });

  it("finish marks done and stamps finishedAt", () => {
    enqueueOne("a");
    useAiQueue.getState().finish("a", "done");
    const item = useAiQueue.getState().items[0];
    expect(item?.status).toBe("done");
    expect(item?.finishedAt).toBeGreaterThan(0);
    expect(item?.errorMessage).toBeUndefined();
  });

  it("finish with error records the message", () => {
    enqueueOne("a");
    useAiQueue.getState().finish("a", "error", "boom");
    expect(useAiQueue.getState().items[0]?.errorMessage).toBe("boom");
  });

  it("abort flips a pending item to aborted", () => {
    enqueueOne("a");
    useAiQueue.getState().abort("a");
    expect(useAiQueue.getState().items[0]?.status).toBe("aborted");
  });

  it("abort flips a running item to aborted", () => {
    enqueueOne("a");
    useAiQueue.getState().start("a");
    useAiQueue.getState().abort("a");
    expect(useAiQueue.getState().items[0]?.status).toBe("aborted");
  });

  it("abort leaves a finished item untouched", () => {
    enqueueOne("a");
    useAiQueue.getState().finish("a", "done");
    useAiQueue.getState().abort("a");
    expect(useAiQueue.getState().items[0]?.status).toBe("done");
  });

  it("clearFinished keeps only pending and running items", () => {
    enqueueOne("a");
    enqueueOne("b");
    enqueueOne("c");
    useAiQueue.getState().start("b");
    useAiQueue.getState().finish("c", "done");
    useAiQueue.getState().clearFinished();
    const ids = useAiQueue.getState().items.map((i) => i.id);
    expect(ids).toEqual(["a", "b"]);
  });

  it("start on an unknown id is a no-op", () => {
    enqueueOne("a");
    useAiQueue.getState().start("missing");
    expect(useAiQueue.getState().items[0]?.status).toBe("pending");
  });
});
