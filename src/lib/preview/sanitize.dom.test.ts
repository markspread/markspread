// Coverage for the preview HTML sanitiser.

import { describe, expect, it } from "vitest";
import { sanitizeHtml } from "./sanitize";

describe("sanitizeHtml", () => {
  it("keeps whitelisted tags and their text", () => {
    const out = sanitizeHtml("<p>hello <strong>world</strong></p>");
    expect(out).toBe("<p>hello <strong>world</strong></p>");
  });

  it("unwraps disallowed elements but keeps their children", () => {
    const out = sanitizeHtml("<div><script>alert(1)</script></div>");
    expect(out).not.toMatch(/<script/i);
  });

  it("preserves prose around a stripped element", () => {
    const out = sanitizeHtml("<p>before<iframe>x</iframe>after</p>");
    expect(out).not.toMatch(/<iframe/i);
    expect(out).toContain("before");
    expect(out).toContain("after");
  });

  it("strips on* event handler attributes", () => {
    const out = sanitizeHtml('<p onclick="evil()">x</p>');
    expect(out).not.toMatch(/onclick/i);
  });

  it("strips non-whitelisted attributes", () => {
    const out = sanitizeHtml('<p style="color:red" id="ok">x</p>');
    expect(out).toContain('id="ok"');
    expect(out).not.toMatch(/style=/);
  });

  it("removes javascript: hrefs", () => {
    const out = sanitizeHtml('<a href="javascript:alert(1)">x</a>');
    expect(out).not.toMatch(/javascript:/i);
  });

  it("keeps safe https hrefs and forces noopener on external links", () => {
    const out = sanitizeHtml('<a href="https://example.com">x</a>');
    expect(out).toContain('href="https://example.com"');
    expect(out).toContain('rel="noopener noreferrer"');
    expect(out).toContain('target="_blank"');
  });

  it("keeps relative and anchor hrefs", () => {
    expect(sanitizeHtml('<a href="./doc.md">x</a>')).toContain('href="./doc.md"');
    expect(sanitizeHtml('<a href="#sec">x</a>')).toContain('href="#sec"');
  });

  it("allows an empty href", () => {
    const out = sanitizeHtml('<a href="">x</a>');
    expect(out).toContain('href=""');
  });

  it("blocks remote images when blockRemoteImages is set", () => {
    const out = sanitizeHtml('<img src="https://cdn.example.com/a.png">', {
      blockRemoteImages: true,
    });
    expect(out).not.toMatch(/src=/);
    expect(out).toContain('data-blocked="remote"');
  });

  it("keeps local images even when blockRemoteImages is set", () => {
    const out = sanitizeHtml('<img src="./local.png">', {
      blockRemoteImages: true,
    });
    expect(out).toContain('src="./local.png"');
  });

  it("leaves a src-less img untouched when blockRemoteImages is set", () => {
    const out = sanitizeHtml("<img>", { blockRemoteImages: true });
    expect(out).toContain("<img");
    expect(out).not.toContain("data-blocked");
  });

  it("keeps remote images when blockRemoteImages is unset", () => {
    const out = sanitizeHtml('<img src="https://cdn.example.com/a.png">');
    expect(out).toContain('src="https://cdn.example.com/a.png"');
  });

  it("preserves svg subset for diagrams", () => {
    const out = sanitizeHtml('<svg viewBox="0 0 1 1"><path d="M0 0"></path></svg>');
    expect(out).toContain("<svg");
    expect(out).toContain("<path");
  });

  it("keeps tag-specific attributes like td colspan", () => {
    const out = sanitizeHtml('<table><tr><td colspan="2">cell</td></tr></table>');
    expect(out).toContain('colspan="2"');
  });

  it("returns an empty string for empty input", () => {
    expect(sanitizeHtml("")).toBe("");
  });

  it("strips a disallowed attribute value but keeps the element", () => {
    const out = sanitizeHtml('<img src="data:text/html,evil">');
    expect(out).toContain("<img");
    expect(out).not.toMatch(/src=/);
  });
});
