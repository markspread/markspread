// Unit tests for the HTML → markdown converter (needs jsdom DOMParser).

import { describe, expect, it } from "vitest";
import { htmlToMarkdown } from "./htmlToMarkdown";

describe("htmlToMarkdown", () => {
  it("converts a paragraph", () => {
    expect(htmlToMarkdown("<p>Hello world</p>")).toBe("Hello world");
  });

  it("collapses inline whitespace inside text nodes", () => {
    expect(htmlToMarkdown("<p>  spaced   out  </p>")).toBe("spaced out");
  });

  it("converts headings h1..h6", () => {
    expect(htmlToMarkdown("<h1>Title</h1>")).toBe("# Title");
    expect(htmlToMarkdown("<h3>Sub</h3>")).toBe("### Sub");
    expect(htmlToMarkdown("<h6>Deep</h6>")).toBe("###### Deep");
  });

  it("converts strong/b and em/i", () => {
    expect(htmlToMarkdown("<p><strong>bold</strong><em>it</em></p>")).toBe("**bold***it*");
    expect(htmlToMarkdown("<p><b>bold</b><i>it</i></p>")).toBe("**bold***it*");
  });

  it("converts strikethrough variants", () => {
    expect(htmlToMarkdown("<p><s>a</s><strike>b</strike><del>c</del></p>")).toBe("~~a~~~~b~~~~c~~");
  });

  it("converts inline code and escapes backticks", () => {
    expect(htmlToMarkdown("<p>run<code>a`b</code></p>")).toBe("run`a\\`b`");
  });

  it("converts a pre>code fenced block with a language class", () => {
    const out = htmlToMarkdown('<pre><code class="language-ts">const x = 1;\n</code></pre>');
    expect(out).toBe("```ts\nconst x = 1;\n```");
  });

  it("converts a pre block without a code child", () => {
    const out = htmlToMarkdown("<pre>plain code\n\n</pre>");
    expect(out).toBe("```\nplain code\n```");
  });

  it("converts links, falling back to href when there is no text", () => {
    expect(htmlToMarkdown('<p><a href="https://x.dev">site</a></p>')).toBe("[site](https://x.dev)");
    expect(htmlToMarkdown('<p><a href="https://x.dev"></a></p>')).toBe(
      "[https://x.dev](https://x.dev)",
    );
  });

  it("converts a link with no href attribute", () => {
    expect(htmlToMarkdown("<p><a>text</a></p>")).toBe("[text]()");
  });

  it("converts images with and without alt text", () => {
    expect(htmlToMarkdown('<img src="a.png" alt="cap">')).toBe("![cap](a.png)");
    expect(htmlToMarkdown('<img src="a.png">')).toBe("![](a.png)");
  });

  it("converts a hard break", () => {
    expect(htmlToMarkdown("<p>a<br>b</p>")).toBe("a  \nb");
  });

  it("converts a horizontal rule", () => {
    expect(htmlToMarkdown("<p>a</p><hr><p>b</p>")).toBe("a\n\n---\n\nb");
  });

  it("converts a blockquote with line prefixes", () => {
    expect(htmlToMarkdown("<blockquote><p>quoted</p></blockquote>")).toBe("> quoted");
  });

  it("converts an unordered list", () => {
    expect(htmlToMarkdown("<ul><li>a</li><li>b</li></ul>")).toBe("- a\n- b");
  });

  it("converts an ordered list", () => {
    expect(htmlToMarkdown("<ol><li>one</li><li>two</li></ol>")).toBe("1. one\n2. two");
  });

  it("converts nested lists with indentation", () => {
    const out = htmlToMarkdown("<ul><li>a<ul><li>b</li></ul></li></ul>");
    expect(out).toContain("- a");
    expect(out).toContain("- b");
  });

  it("converts a regular GFM table", () => {
    const out = htmlToMarkdown(
      "<table><thead><tr><th>H1</th><th>H2</th></tr></thead>" +
        "<tbody><tr><td>a</td><td>b</td></tr></tbody></table>",
    );
    expect(out).toBe("| H1 | H2 |\n| --- | --- |\n| a | b |");
  });

  it("escapes pipes and collapses newlines inside table cells", () => {
    const out = htmlToMarkdown("<table><tr><td>a|b</td></tr></table>");
    expect(out).toContain("a\\|b");
  });

  it("falls back to plain text when table rows are irregular", () => {
    const out = htmlToMarkdown("<table><tr><td>a</td><td>b</td></tr><tr><td>c</td></tr></table>");
    expect(out).toBe("abc");
  });

  it("returns null-equivalent fallback for an empty table", () => {
    expect(htmlToMarkdown("<table></table>")).toBe("");
  });

  it("descends through unknown wrappers like div and span", () => {
    expect(htmlToMarkdown("<div><span>nested</span></div>")).toBe("nested");
  });

  it("ignores comment nodes", () => {
    expect(htmlToMarkdown("<p>a<!-- comment -->b</p>")).toBe("ab");
  });

  it("collapses runaway blank lines and trims the result", () => {
    expect(htmlToMarkdown("<p>a</p><p>b</p>")).toBe("a\n\nb");
  });
});
