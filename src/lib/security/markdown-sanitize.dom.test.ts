// S-SE-015..018: markdown sanitiser.

import { describe, expect, it } from "vitest";
import { DEFAULT_SANITISE_OPTIONS, sanitiseMarkdownHtml } from "./markdown-sanitize";

describe("sanitiseMarkdownHtml", () => {
  it("strips <script> elements entirely", () => {
    const out = sanitiseMarkdownHtml("<p>hi</p><script>alert(1)</script>");
    expect(out).not.toContain("script");
    expect(out).toContain("hi");
  });

  it("strips <style>, <iframe>, <object>, <embed>, <frame>, <frameset>", () => {
    const inputs = ["style", "iframe", "object", "embed", "frame", "frameset"];
    for (const tag of inputs) {
      const out = sanitiseMarkdownHtml(`<${tag}>x</${tag}>`);
      expect(out).not.toContain(`<${tag}`);
    }
  });

  it("flattens unknown tags into their text content", () => {
    const out = sanitiseMarkdownHtml("<weirdtag>kept text</weirdtag>");
    expect(out).not.toContain("weirdtag");
    expect(out).toContain("kept text");
  });

  it("removes on* event handlers", () => {
    const out = sanitiseMarkdownHtml('<a href="/x" onclick="evil()">go</a>');
    expect(out).not.toMatch(/onclick/i);
    expect(out).toContain("/x");
  });

  it("drops attributes not in the allow-list", () => {
    const out = sanitiseMarkdownHtml('<a href="/x" data-tracking="bad">go</a>');
    expect(out).not.toMatch(/data-tracking/);
  });

  it("rejects javascript: hrefs but keeps the anchor", () => {
    const out = sanitiseMarkdownHtml('<a href="javascript:alert(1)">x</a>');
    expect(out).not.toMatch(/javascript:/i);
  });

  it("keeps relative, anchor, and absolute http(s) hrefs", () => {
    expect(sanitiseMarkdownHtml('<a href="#sec">x</a>')).toContain("#sec");
    expect(sanitiseMarkdownHtml('<a href="/abs">x</a>')).toContain("/abs");
    expect(sanitiseMarkdownHtml('<a href="./rel">x</a>')).toContain("./rel");
    expect(sanitiseMarkdownHtml('<a href="https://ex.com">x</a>')).toContain("https://ex.com");
  });

  it("strips malformed hrefs that throw inside URL parsing", () => {
    // URL() throws on inputs containing percent-decoded invalid escapes
    const out = sanitiseMarkdownHtml('<a href="http://[not-an-ipv6">x</a>');
    expect(out).not.toMatch(/href="http:\/\/\[not-an-ipv6"/);
  });

  it("hardens outbound http(s) links with target and rel", () => {
    const out = sanitiseMarkdownHtml('<a href="https://ex.com">x</a>');
    expect(out).toContain('target="_blank"');
    expect(out).toContain('rel="noopener noreferrer"');
  });

  it("skips hardening on non-http hrefs", () => {
    const out = sanitiseMarkdownHtml('<a href="mailto:a@b">x</a>');
    expect(out).not.toContain("target=");
  });

  it("keeps inline data:image/* on <img> and drops javascript: in img src", () => {
    const ok = sanitiseMarkdownHtml('<img src="data:image/png;base64,iVBORw0KGgo=" alt="x">');
    expect(ok).toContain("data:image/png");
    const bad = sanitiseMarkdownHtml('<img src="javascript:alert(1)" alt="x">');
    expect(bad).not.toMatch(/src="javascript:/i);
  });

  it("blocks external images when blockExternalImages is true", () => {
    const out = sanitiseMarkdownHtml('<img src="https://ex.com/x.png" alt="x">', {
      blockExternalImages: true,
      hardenLinks: true,
    });
    expect(out).not.toMatch(/src="https/);
  });

  it("allows relative img src", () => {
    const out = sanitiseMarkdownHtml('<img src="./local.png" alt="x">');
    expect(out).toContain("./local.png");
  });

  it("drops img src that fails URL parsing", () => {
    const out = sanitiseMarkdownHtml('<img src="http://[bad" alt="x">');
    expect(out).not.toMatch(/src="http:/);
  });

  it("uses DEFAULT_SANITISE_OPTIONS when no opts are passed", () => {
    expect(DEFAULT_SANITISE_OPTIONS.hardenLinks).toBe(true);
    expect(DEFAULT_SANITISE_OPTIONS.blockExternalImages).toBe(false);
  });
});
