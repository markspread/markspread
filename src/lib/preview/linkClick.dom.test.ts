// Coverage for the preview-pane link click router.

import { describe, expect, it, vi } from "vitest";
import { type LinkClickHost, attachLinkClickHandler } from "./linkClick";

function makeHost(resolve: LinkClickHost["resolveInternal"]): {
  host: LinkClickHost;
  openExternal: ReturnType<typeof vi.fn>;
  openInternal: ReturnType<typeof vi.fn>;
} {
  const openExternal = vi.fn(async () => undefined);
  const openInternal = vi.fn(async () => undefined);
  return {
    openExternal,
    openInternal,
    host: { openExternal, openInternal, resolveInternal: resolve },
  };
}

function clickAnchor(root: HTMLElement, selector: string): MouseEvent {
  const a = root.querySelector<HTMLElement>(selector);
  const ev = new MouseEvent("click", { bubbles: true, cancelable: true });
  a?.dispatchEvent(ev);
  return ev;
}

describe("attachLinkClickHandler", () => {
  it("routes external links to openExternal", () => {
    const root = document.createElement("div");
    root.innerHTML = '<a href="https://example.com">x</a>';
    const { host, openExternal } = makeHost(() => null);
    attachLinkClickHandler(root, host);
    clickAnchor(root, "a");
    expect(openExternal).toHaveBeenCalledWith("https://example.com");
  });

  it("routes internal links to openInternal with anchor", () => {
    const root = document.createElement("div");
    root.innerHTML = '<a href="./doc.md#sec">x</a>';
    const { host, openInternal } = makeHost(() => ({
      path: "doc.md",
      anchor: "sec",
    }));
    attachLinkClickHandler(root, host);
    clickAnchor(root, "a");
    expect(openInternal).toHaveBeenCalledWith("doc.md", "sec");
  });

  it("ignores in-page anchor links starting with #", () => {
    const root = document.createElement("div");
    root.innerHTML = '<a href="#top">x</a>';
    const { host, openExternal, openInternal } = makeHost(() => null);
    attachLinkClickHandler(root, host);
    const ev = clickAnchor(root, "a");
    expect(openExternal).not.toHaveBeenCalled();
    expect(openInternal).not.toHaveBeenCalled();
    expect(ev.defaultPrevented).toBe(false);
  });

  it("ignores clicks that are not on an anchor", () => {
    const root = document.createElement("div");
    root.innerHTML = "<p><span>plain</span></p>";
    const { host, openExternal } = makeHost(() => null);
    attachLinkClickHandler(root, host);
    clickAnchor(root, "span");
    expect(openExternal).not.toHaveBeenCalled();
  });

  it("ignores anchors with no href attribute", () => {
    const root = document.createElement("div");
    root.innerHTML = "<a>x</a>";
    const { host, openExternal } = makeHost(() => null);
    attachLinkClickHandler(root, host);
    clickAnchor(root, "a");
    expect(openExternal).not.toHaveBeenCalled();
  });

  it("resolves clicks bubbling from a child of the anchor", () => {
    const root = document.createElement("div");
    root.innerHTML = '<a href="https://x.com"><span>child</span></a>';
    const { host, openExternal } = makeHost(() => null);
    attachLinkClickHandler(root, host);
    clickAnchor(root, "span");
    expect(openExternal).toHaveBeenCalledWith("https://x.com");
  });

  it("prevents default navigation for handled links", () => {
    const root = document.createElement("div");
    root.innerHTML = '<a href="https://x.com">x</a>';
    const { host } = makeHost(() => null);
    attachLinkClickHandler(root, host);
    const ev = clickAnchor(root, "a");
    expect(ev.defaultPrevented).toBe(true);
  });

  it("returns a disposer that removes the listener", () => {
    const root = document.createElement("div");
    root.innerHTML = '<a href="https://x.com">x</a>';
    const { host, openExternal } = makeHost(() => null);
    const dispose = attachLinkClickHandler(root, host);
    dispose();
    // Drop the href before dispatching so jsdom does not attempt a
    // real navigation once the routing listener is gone.
    root.querySelector("a")?.removeAttribute("href");
    clickAnchor(root, "a");
    expect(openExternal).not.toHaveBeenCalled();
  });
});
