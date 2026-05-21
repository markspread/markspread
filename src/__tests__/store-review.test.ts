// Unit tests for the AI review session store.

import { beforeEach, describe, expect, it } from "vitest";
import type { ReviewComment } from "../lib/ai/review";
import { useReview } from "../store/review";

function comment(over: Partial<ReviewComment> = {}): ReviewComment {
  return {
    id: "c1",
    anchorLine: 1,
    message: "msg",
    status: "pending",
    ...over,
  };
}

beforeEach(() => {
  useReview.setState({ active: false, comments: [], progress: null, error: null });
});

describe("review store", () => {
  it("start activates a fresh session", () => {
    useReview.setState({ comments: [comment()], error: "old" });
    useReview.getState().start();
    const s = useReview.getState();
    expect(s.active).toBe(true);
    expect(s.comments).toEqual([]);
    expect(s.error).toBeNull();
    expect(s.progress?.line).toBe(0);
    expect(typeof s.progress?.startedAt).toBe("number");
  });

  it("ingest 'comment' appends the comment", () => {
    useReview.getState().start();
    useReview.getState().ingest({ type: "comment", comment: comment({ id: "x" }) });
    expect(useReview.getState().comments.map((c) => c.id)).toEqual(["x"]);
  });

  it("ingest 'delta' appends text to the matching comment message", () => {
    useReview.setState({ comments: [comment({ id: "x", message: "Hello" })] });
    useReview.getState().ingest({ type: "delta", id: "x", messageDelta: " world" });
    expect(useReview.getState().comments[0]?.message).toBe("Hello world");
  });

  it("ingest 'delta' ignores an unknown id", () => {
    useReview.setState({ comments: [comment({ id: "x", message: "Hello" })] });
    useReview.getState().ingest({ type: "delta", id: "missing", messageDelta: "!" });
    expect(useReview.getState().comments[0]?.message).toBe("Hello");
  });

  it("ingest 'progress' updates the progress line", () => {
    useReview.getState().start();
    useReview.getState().ingest({ type: "progress", line: 12 });
    expect(useReview.getState().progress?.line).toBe(12);
  });

  it("ingest 'progress' is a no-op when no progress exists", () => {
    useReview.setState({ progress: null });
    useReview.getState().ingest({ type: "progress", line: 3 });
    expect(useReview.getState().progress).toBeNull();
  });

  it("ingest 'error' deactivates and records the message", () => {
    useReview.getState().start();
    useReview.getState().ingest({ type: "error", message: "boom" });
    expect(useReview.getState().active).toBe(false);
    expect(useReview.getState().error).toBe("boom");
  });

  it("ingest 'done' deactivates without an error", () => {
    useReview.getState().start();
    useReview.getState().ingest({ type: "done" });
    expect(useReview.getState().active).toBe(false);
    expect(useReview.getState().error).toBeNull();
  });

  it("finish deactivates the session", () => {
    useReview.getState().start();
    useReview.getState().finish();
    expect(useReview.getState().active).toBe(false);
  });

  it("abort deactivates and clears progress", () => {
    useReview.getState().start();
    useReview.getState().abort();
    expect(useReview.getState().active).toBe(false);
    expect(useReview.getState().progress).toBeNull();
  });

  it("applyOne rewrites the doc and marks the comment applied", () => {
    useReview.setState({
      comments: [
        comment({
          id: "x",
          anchorLine: 2,
          suggestion: { text: "REPLACED", anchorEndLine: 2 },
        }),
      ],
    });
    const result = useReview.getState().applyOne("x", "a\nb\nc");
    expect(result).toEqual({ doc: "a\nREPLACED\nc" });
    expect(useReview.getState().comments[0]?.status).toBe("applied");
  });

  it("applyOne returns null for an unknown id", () => {
    expect(useReview.getState().applyOne("nope", "doc")).toBeNull();
  });

  it("applyOne returns null when the comment has no suggestion", () => {
    useReview.setState({ comments: [comment({ id: "x" })] });
    expect(useReview.getState().applyOne("x", "doc")).toBeNull();
  });

  it("applyOne leaves other comments untouched", () => {
    useReview.setState({
      comments: [
        comment({ id: "x", anchorLine: 2, suggestion: { text: "X", anchorEndLine: 2 } }),
        comment({ id: "y", anchorLine: 3, suggestion: { text: "Y", anchorEndLine: 3 } }),
      ],
    });
    useReview.getState().applyOne("x", "a\nb\nc");
    const after = useReview.getState().comments;
    expect(after.find((c) => c.id === "x")?.status).toBe("applied");
    expect(after.find((c) => c.id === "y")?.status).toBe("pending");
  });

  it("applyOne returns null for an already-applied comment", () => {
    useReview.setState({
      comments: [
        comment({
          id: "x",
          status: "applied",
          suggestion: { text: "t", anchorEndLine: 1 },
        }),
      ],
    });
    expect(useReview.getState().applyOne("x", "doc")).toBeNull();
  });

  it("applyAll applies every pending suggestion and reports skipped", () => {
    useReview.setState({
      comments: [
        comment({ id: "a", anchorLine: 1, suggestion: { text: "A", anchorEndLine: 1 } }),
        comment({ id: "b", anchorLine: 2, suggestion: { text: "B", anchorEndLine: 2 } }),
      ],
    });
    const result = useReview.getState().applyAll("x\ny\nz");
    expect(result?.doc).toBe("A\nB\nz");
    expect(result?.skippedCount).toBe(0);
    expect(useReview.getState().comments.every((c) => c.status === "applied")).toBe(true);
  });

  it("applyAll returns null when nothing is pending", () => {
    useReview.setState({ comments: [comment({ id: "a", status: "applied" })] });
    expect(useReview.getState().applyAll("doc")).toBeNull();
  });

  it("applyAll reports a stale suggestion as skipped", () => {
    useReview.setState({
      comments: [
        comment({ id: "a", anchorLine: 99, suggestion: { text: "A", anchorEndLine: 99 } }),
      ],
    });
    const result = useReview.getState().applyAll("only-one-line");
    expect(result?.skippedCount).toBe(1);
    expect(useReview.getState().comments[0]?.status).toBe("pending");
  });

  it("dismiss flips a comment to dismissed", () => {
    useReview.setState({ comments: [comment({ id: "x" })] });
    useReview.getState().dismiss("x");
    expect(useReview.getState().comments[0]?.status).toBe("dismissed");
  });

  it("dismiss leaves other comments untouched", () => {
    useReview.setState({ comments: [comment({ id: "x" }), comment({ id: "y" })] });
    useReview.getState().dismiss("x");
    expect(useReview.getState().comments[1]?.status).toBe("pending");
  });

  it("remap re-anchors comments through the supplied line map", () => {
    useReview.setState({ comments: [comment({ id: "x", anchorLine: 3 })] });
    useReview.getState().remap((line) => line + 10);
    expect(useReview.getState().comments[0]?.anchorLine).toBe(13);
  });

  it("remap marks a comment stale when its anchor line is removed", () => {
    useReview.setState({ comments: [comment({ id: "x", anchorLine: 3 })] });
    useReview.getState().remap(() => null);
    expect(useReview.getState().comments[0]?.status).toBe("stale");
  });
});
