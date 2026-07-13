// @vitest-environment jsdom
// SC-BASE-02/03/04/05/06 against the *real* shiki/katex packages — no
// module mocks. Exists because R2 regression caught a bug the mocked
// suites replicated instead of catching: shiki.ts declared (and mocks
// implemented) `loadedLanguages()` while shiki v4's actual API is
// `getLoadedLanguages()`, so every production highlight call threw and
// fell back to plain <pre>. Real-dependency coverage pins the external
// contracts themselves.
import { describe, expect, it } from "vitest";
import { renderMathIn } from "./katex";
import { render } from "./render";
import { configureShiki, highlightCode } from "./shiki";

const hl = (c: string, l: string) => highlightCode(c, l);

const shikiReady = configureShiki({
  themes: { light: "github-light", dark: "github-dark" },
  langs: ["typescript"],
});

describe("preview pipeline against real dependencies", () => {
  it("SC-BASE-05: ts fence gets real shiki highlight through render()", async () => {
    await shikiReady;
    const html = await render("```typescript\nconst a = 1\n```\n", { highlightCode: hl });
    expect(html).toContain("--shiki-light");
  });

  it("SC-BASE-05(b): direct highlightCode with warmed grammar", async () => {
    await shikiReady;
    const out = await highlightCode("const a = 1", "typescript").catch((e) => `THREW: ${e}`);
    expect(out).toContain("shiki");
    expect(out).not.toContain("THREW");
  });

  it("SC-BASE-05(c): unloaded grammar is loaded on demand, not fallback", async () => {
    await shikiReady;
    const out = await highlightCode("SELECT 1;", "sql");
    expect(out).toContain("--shiki-light");
  });

  it("SC-BASE-02: mermaid fence survives sanitize→highlight as code.language-mermaid", async () => {
    await shikiReady;
    const html = await render("```mermaid\ngraph TD; A-->B\n```\n", { highlightCode: hl });
    const div = document.createElement("div");
    div.innerHTML = html;
    expect(div.querySelector("pre > code.language-mermaid")).not.toBeNull();
  });

  it("SC-BASE-03: $/$$ → .ms-math placeholders → real KaTeX typesets", async () => {
    const html = await render("inline $E=mc^2$ and\n\n$$\\int_0^1 x\\,dx$$\n");
    const div = document.createElement("div");
    div.innerHTML = html;
    expect(div.querySelector("span.ms-math[data-mode='inline']")).not.toBeNull();
    expect(div.querySelector("div.ms-math[data-mode='block']")).not.toBeNull();
    await renderMathIn(div);
    expect(div.querySelectorAll(".ms-math[data-rendered] .katex").length).toBe(2);
  });

  it("SC-BASE-03(b): single-line $$x$$ typesets as display math, not inline", async () => {
    const html = await render("$$E=mc^2$$\n");
    const div = document.createElement("div");
    div.innerHTML = html;
    expect(div.querySelector("div.ms-math[data-mode='block']")).not.toBeNull();
    expect(div.querySelector("span.ms-math[data-mode='inline']")).toBeNull();
    await renderMathIn(div);
    expect(div.querySelector(".katex-display")).not.toBeNull();
  });

  it("SC-BASE-03(c): single dollars stay inline", async () => {
    const html = await render("stays $x+1$ inline\n");
    const div = document.createElement("div");
    div.innerHTML = html;
    expect(div.querySelector("span.ms-math[data-mode='inline']")).not.toBeNull();
    expect(div.querySelector("div.ms-math[data-mode='block']")).toBeNull();
  });

  it("SC-BASE-04: frontmatter stripped — no hr/h2 leakage", async () => {
    const md = "---\ntitle: Hello\ndate: 2026-07-12\n---\n\n# Body\n\ntext";
    const html = await render(md);
    const div = document.createElement("div");
    div.innerHTML = html;
    expect(div.querySelector("hr")).toBeNull();
    expect(div.querySelector("h2")).toBeNull();
    expect(html).not.toContain("title: Hello");
    expect(div.querySelector("h1")?.textContent).toBe("Body");
  });

  it("SC-BASE-04(b): unclosed fence is NOT frontmatter — body intact", async () => {
    const html = await render("---\ntitle: not closed\n\n# Real doc");
    expect(html).toContain("title: not closed");
  });

  it("SC-BASE-06 spot check: script/onerror stripped even with highlight active", async () => {
    await shikiReady;
    const html = await render(
      '<script>alert(1)</script><img src="x" onerror="alert(1)">\n\n```html\n<script>alert(2)</script>\n```\n',
      { highlightCode: hl },
    );
    expect(html).not.toContain("<script>");
    expect(html).not.toContain("onerror");
    expect(html).not.toMatch(/<img[^>]*onerror/);
  });
});
