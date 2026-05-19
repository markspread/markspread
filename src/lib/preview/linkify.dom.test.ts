// Coverage for the plain-text URL autolinker.

import { describe, expect, it } from "vitest";
import { linkifyTextNodes } from "./linkify";

describe("linkifyTextNodes", () => {
  it("wraps a bare http URL in an anchor", () => {
    const root = document.createElement("div");
    root.innerHTML = "<p>see https://example.com here</p>";
    linkifyTextNodes(root);
    const a = root.querySelector("a");
    expect(a?.getAttribute("href")).toBe("https://example.com");
    expect(a?.textContent).toBe("https://example.com");
    expect(a?.rel).toBe("noopener noreferrer");
    expect(a?.target).toBe("_blank");
  });

  it("upgrades www. URLs to https://", () => {
    const root = document.createElement("div");
    root.innerHTML = "<p>visit www.example.com</p>";
    linkifyTextNodes(root);
    expect(root.querySelector("a")?.getAttribute("href")).toBe("https://www.example.com");
  });

  it("linkifies mailto: addresses", () => {
    const root = document.createElement("div");
    root.innerHTML = "<p>mail mailto:foo@bar.com today</p>";
    linkifyTextNodes(root);
    expect(root.querySelector("a")?.getAttribute("href")).toBe("mailto:foo@bar.com");
  });

  it("strips trailing punctuation off the URL", () => {
    const root = document.createElement("div");
    root.innerHTML = "<p>(see https://example.com).</p>";
    linkifyTextNodes(root);
    const a = root.querySelector("a");
    expect(a?.getAttribute("href")).toBe("https://example.com");
    expect(root.textContent).toContain(").");
  });

  it("skips text already inside an anchor", () => {
    const root = document.createElement("div");
    root.innerHTML = '<a href="x">https://example.com</a>';
    linkifyTextNodes(root);
    expect(root.querySelectorAll("a")).toHaveLength(1);
    expect(root.querySelector("a")?.getAttribute("href")).toBe("x");
  });

  it("skips text inside code/pre/kbd/script/style elements", () => {
    for (const tag of ["code", "pre", "kbd"]) {
      const root = document.createElement("div");
      root.innerHTML = `<${tag}>https://example.com</${tag}>`;
      linkifyTextNodes(root);
      expect(root.querySelector("a")).toBeNull();
    }
  });

  it("leaves plain text without URLs untouched", () => {
    const root = document.createElement("div");
    root.innerHTML = "<p>just words</p>";
    linkifyTextNodes(root);
    expect(root.querySelector("a")).toBeNull();
    expect(root.textContent).toBe("just words");
  });

  it("handles multiple URLs in one text node", () => {
    const root = document.createElement("div");
    root.innerHTML = "<p>a https://one.com b https://two.com c</p>";
    linkifyTextNodes(root);
    const hrefs = Array.from(root.querySelectorAll("a")).map((a) => a.getAttribute("href"));
    expect(hrefs).toEqual(["https://one.com", "https://two.com"]);
  });

  it("preserves text before, between, and after URLs", () => {
    const root = document.createElement("div");
    root.innerHTML = "<p>before https://x.com after</p>";
    linkifyTextNodes(root);
    expect(root.textContent).toBe("before https://x.com after");
  });

  it("handles a URL at the very start of a text node", () => {
    const root = document.createElement("div");
    root.innerHTML = "<p>https://x.com trailing</p>";
    linkifyTextNodes(root);
    expect(root.querySelector("a")?.getAttribute("href")).toBe("https://x.com");
  });
});
