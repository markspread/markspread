// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { computeInlineDiff } from "../lib/editor/drag-chat-edit";
import { InlineDiffOverlay } from "./InlineDiffOverlay";

afterEach(cleanup);

describe("InlineDiffOverlay", () => {
  it("returns null when diff is null", () => {
    const { container } = render(<InlineDiffOverlay diff={null} onDecision={() => {}} />);
    expect(container.firstChild).toBeNull();
  });

  it("renders chunks for an added line", () => {
    const diff = computeInlineDiff("hello", "hello world");
    render(<InlineDiffOverlay diff={diff} onDecision={() => {}} />);
    const overlay = screen.getByTestId("inline-diff-overlay");
    expect(overlay).toBeTruthy();
    // 변경 표시 chunk 확인
    const addChunks = overlay.querySelectorAll('[data-chunk-kind="add"]');
    expect(addChunks.length).toBeGreaterThan(0);
  });

  it("renders both add and remove chunks for mixed diff", () => {
    const diff = computeInlineDiff("hello\nworld", "hello\nthere");
    render(<InlineDiffOverlay diff={diff} onDecision={() => {}} />);
    expect(document.querySelectorAll('[data-chunk-kind="add"]').length).toBeGreaterThan(0);
    expect(document.querySelectorAll('[data-chunk-kind="remove"]').length).toBeGreaterThan(0);
  });

  it("Accept button fires accept decision", () => {
    const onDecision = vi.fn();
    render(<InlineDiffOverlay diff={computeInlineDiff("a", "b")} onDecision={onDecision} />);
    fireEvent.click(screen.getByTestId("inline-diff-accept"));
    expect(onDecision).toHaveBeenCalledWith("accept");
  });

  it("Reject button fires reject decision", () => {
    const onDecision = vi.fn();
    render(<InlineDiffOverlay diff={computeInlineDiff("a", "b")} onDecision={onDecision} />);
    fireEvent.click(screen.getByTestId("inline-diff-reject"));
    expect(onDecision).toHaveBeenCalledWith("reject");
  });

  it("Retry button fires retry decision", () => {
    const onDecision = vi.fn();
    render(<InlineDiffOverlay diff={computeInlineDiff("a", "b")} onDecision={onDecision} />);
    fireEvent.click(screen.getByTestId("inline-diff-retry"));
    expect(onDecision).toHaveBeenCalledWith("retry");
  });

  it("custom position is applied via inline style", () => {
    render(
      <InlineDiffOverlay
        diff={computeInlineDiff("a", "b")}
        onDecision={() => {}}
        position={{ top: 100, left: 200 }}
      />,
    );
    const overlay = screen.getByTestId("inline-diff-overlay") as HTMLElement;
    expect(overlay.style.top).toBe("100px");
    expect(overlay.style.left).toBe("200px");
  });

  it("centers when no position provided", () => {
    render(<InlineDiffOverlay diff={computeInlineDiff("a", "b")} onDecision={() => {}} />);
    const overlay = screen.getByTestId("inline-diff-overlay") as HTMLElement;
    expect(overlay.style.top).toBe("50%");
    expect(overlay.style.left).toBe("50%");
  });

  it("button labels include hotkey hints", () => {
    render(<InlineDiffOverlay diff={computeInlineDiff("a", "b")} onDecision={() => {}} />);
    expect(screen.getByTestId("inline-diff-accept").textContent).toContain("↵");
    expect(screen.getByTestId("inline-diff-reject").textContent).toContain("Esc");
    expect(screen.getByTestId("inline-diff-retry").textContent).toContain("⌘R");
  });
});
