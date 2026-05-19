// Coverage for the code-block copy button post-processor.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { attachCodeCopyButtons } from "./codeCopyButton";

function flush(): Promise<void> {
  return new Promise((r) => setTimeout(r, 0));
}

describe("attachCodeCopyButtons", () => {
  beforeEach(() => {
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: { writeText: vi.fn(async () => undefined) },
    });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("appends a copy button to each pre>code block", () => {
    const root = document.createElement("div");
    root.innerHTML = "<pre><code>hello()</code></pre>";
    attachCodeCopyButtons(root);
    const btn = root.querySelector("button.ms-code-copy");
    expect(btn).not.toBeNull();
    expect(btn?.textContent).toBe("Copy");
    expect(btn?.getAttribute("aria-label")).toBe("Copy");
    expect(root.querySelector("pre")?.classList.contains("ms-code-block")).toBe(true);
  });

  it("uses custom labels when provided", () => {
    const root = document.createElement("div");
    root.innerHTML = "<pre><code>x</code></pre>";
    attachCodeCopyButtons(root, { copy: "복사", copied: "복사됨" });
    expect(root.querySelector("button")?.textContent).toBe("복사");
  });

  it("is idempotent — skips already-decorated blocks", () => {
    const root = document.createElement("div");
    root.innerHTML = "<pre><code>x</code></pre>";
    attachCodeCopyButtons(root);
    attachCodeCopyButtons(root);
    expect(root.querySelectorAll("button.ms-code-copy")).toHaveLength(1);
  });

  it("copies the code text and shows the copied label, then reverts", async () => {
    vi.useFakeTimers();
    const root = document.createElement("div");
    root.innerHTML = "<pre><code>console.log(1)</code></pre>";
    attachCodeCopyButtons(root);
    const btn = root.querySelector<HTMLButtonElement>("button.ms-code-copy");
    btn?.dispatchEvent(new MouseEvent("click", { cancelable: true }));
    await vi.advanceTimersByTimeAsync(0);
    expect(navigator.clipboard.writeText).toHaveBeenCalledWith("console.log(1)");
    expect(btn?.textContent).toBe("Copied");
    expect(btn?.disabled).toBe(true);
    await vi.advanceTimersByTimeAsync(1200);
    expect(btn?.textContent).toBe("Copy");
    expect(btn?.disabled).toBe(false);
  });

  it("does not change the label when clipboard write fails", async () => {
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: {
        writeText: vi.fn(async () => {
          throw new Error("denied");
        }),
      },
    });
    const root = document.createElement("div");
    root.innerHTML = "<pre><code>x</code></pre>";
    attachCodeCopyButtons(root);
    const btn = root.querySelector<HTMLButtonElement>("button.ms-code-copy");
    btn?.dispatchEvent(new MouseEvent("click", { cancelable: true }));
    await flush();
    expect(btn?.textContent).toBe("Copy");
  });

  it("ignores code nodes that are not inside a pre", () => {
    const root = document.createElement("div");
    root.innerHTML = "<p><code>inline</code></p>";
    attachCodeCopyButtons(root);
    expect(root.querySelector("button.ms-code-copy")).toBeNull();
  });
});
