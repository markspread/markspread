// S-PR-007 / S-PR-022: Shiki-based syntax highlighting for preview
// code blocks, with light/dark theme syncing.
//
// We expose a host API:
//   • configureShiki({ light, dark, langs }) — eager-loads Shiki and
//     pre-warms the requested grammars/themes.
//   • highlightCode(code, lang) — the function passed to `render()`.
//     If Shiki isn't ready or the language isn't loaded, we fall
//     back to a `<pre><code class="language-…">` block so the user
//     still sees the source.
//
// Theme syncing (S-PR-022): callers detect the active theme (the
// `data-theme` attribute on <html> or `prefers-color-scheme`) and
// pass `{ theme: "ms-light" | "ms-dark" }` per render. Shiki tokens
// carry `--shiki-dark` CSS vars so the same HTML supports both
// themes via CSS — re-rendering on theme switch is unnecessary.

let shikiPromise: Promise<ShikiCore | null> | null = null;

export interface ShikiConfig {
  themes: { light: string; dark: string };
  langs: string[];
}

interface ShikiCore {
  codeToHtml(
    code: string,
    opts: {
      lang: string;
      themes: { light: string; dark: string };
      defaultColor?: false;
    },
  ): string;
  loadedLanguages(): string[];
  loadLanguage(lang: string): Promise<void>;
}

let activeConfig: ShikiConfig | null = null;

export async function configureShiki(cfg: ShikiConfig): Promise<void> {
  activeConfig = cfg;
  shikiPromise = (async () => {
    try {
      const shiki = await import("shiki");
      const highlighter = await shiki.createHighlighter({
        themes: [cfg.themes.light, cfg.themes.dark] as never,
        langs: cfg.langs as never,
      });
      return highlighter as unknown as ShikiCore;
    } catch {
      return null;
    }
  })();
}

export async function highlightCode(code: string, lang: string): Promise<string> {
  if (!shikiPromise || !activeConfig) {
    return fallback(code, lang);
  }
  const highlighter = await shikiPromise;
  if (!highlighter) return fallback(code, lang);
  const langKey = lang || "text";
  if (!highlighter.loadedLanguages().includes(langKey)) {
    try {
      await highlighter.loadLanguage(langKey);
    } catch {
      return fallback(code, lang);
    }
  }
  return highlighter.codeToHtml(code, {
    lang: langKey,
    themes: activeConfig.themes,
    defaultColor: false,
  });
}

function fallback(code: string, lang: string): string {
  const cls = lang ? ` class="language-${lang}"` : "";
  const escaped = code.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  return `<pre><code${cls}>${escaped}</code></pre>`;
}
