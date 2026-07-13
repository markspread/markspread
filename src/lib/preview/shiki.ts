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
//
// Bundle budget (S-PF-019 / ADR-0007): the full `shiki` bundle ships
// every grammar and theme (~2.3 MB gzip of emitted chunks), which
// blows the total-JS ceiling on its own. We therefore build on
// @shikijs/core with the JavaScript regex engine and a curated loader
// map — only the grammars/themes named below can ever enter the
// bundle, each as its own lazy chunk. Languages outside the map fall
// back to the plain <pre><code> path.

let shikiPromise: Promise<ShikiCore | null> | null = null;

export interface ShikiConfig {
  themes: { light: string; dark: string };
  langs: string[];
}

// Registration payloads are opaque data modules — the highlighter is
// the only consumer, so `unknown` keeps @shikijs types out of the
// module graph (same rationale as the structural interfaces below).
type RegistrationLoader = () => Promise<{ default: unknown }>;

// Curated grammar set: the languages the docs surface actually meets
// (matches the code-viewer language set plus common doc fences). Add a
// line here deliberately — every entry is bundle weight.
const LANG_LOADERS: Record<string, RegistrationLoader> = {
  bash: () => import("@shikijs/langs/bash"),
  css: () => import("@shikijs/langs/css"),
  diff: () => import("@shikijs/langs/diff"),
  dockerfile: () => import("@shikijs/langs/dockerfile"),
  go: () => import("@shikijs/langs/go"),
  html: () => import("@shikijs/langs/html"),
  javascript: () => import("@shikijs/langs/javascript"),
  json: () => import("@shikijs/langs/json"),
  jsonc: () => import("@shikijs/langs/jsonc"),
  jsx: () => import("@shikijs/langs/jsx"),
  markdown: () => import("@shikijs/langs/markdown"),
  python: () => import("@shikijs/langs/python"),
  rust: () => import("@shikijs/langs/rust"),
  sql: () => import("@shikijs/langs/sql"),
  toml: () => import("@shikijs/langs/toml"),
  tsx: () => import("@shikijs/langs/tsx"),
  typescript: () => import("@shikijs/langs/typescript"),
  xml: () => import("@shikijs/langs/xml"),
  yaml: () => import("@shikijs/langs/yaml"),
};

// Fence-tag conveniences → canonical grammar ids.
const LANG_ALIASES: Record<string, string> = {
  golang: "go",
  js: "javascript",
  md: "markdown",
  py: "python",
  rs: "rust",
  sh: "bash",
  shell: "bash",
  ts: "typescript",
  yml: "yaml",
  zsh: "bash",
};

const THEME_LOADERS: Record<string, RegistrationLoader> = {
  "github-dark": () => import("@shikijs/themes/github-dark"),
  "github-light": () => import("@shikijs/themes/github-light"),
};

interface ShikiCore {
  codeToHtml(
    code: string,
    opts: {
      lang: string;
      themes: { light: string; dark: string };
      defaultColor?: false;
    },
  ): string;
  getLoadedLanguages(): string[];
  loadLanguage(lang: unknown): Promise<void>;
}

let activeConfig: ShikiConfig | null = null;

function resolveLang(lang: string): string {
  return LANG_ALIASES[lang] ?? lang;
}

export async function configureShiki(cfg: ShikiConfig): Promise<void> {
  activeConfig = cfg;
  shikiPromise = (async () => {
    try {
      const [{ createHighlighterCore }, { createJavaScriptRegexEngine }] = await Promise.all([
        import("@shikijs/core"),
        import("@shikijs/engine-javascript"),
      ]);
      const themeLoaders = [cfg.themes.light, cfg.themes.dark].map((t) => {
        const load = THEME_LOADERS[t];
        if (!load) throw new Error(`theme not in curated set: ${t}`);
        return load();
      });
      const langLoaders = cfg.langs.map((l) => {
        const load = LANG_LOADERS[resolveLang(l)];
        if (!load) throw new Error(`grammar not in curated set: ${l}`);
        return load();
      });
      const [themes, langs] = await Promise.all([
        Promise.all(themeLoaders),
        Promise.all(langLoaders),
      ]);
      const highlighter = await createHighlighterCore({
        themes: themes.map((m) => m.default) as never,
        langs: langs.map((m) => m.default) as never,
        engine: createJavaScriptRegexEngine(),
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
  const langKey = resolveLang(lang || "text");
  if (!highlighter.getLoadedLanguages().includes(langKey)) {
    const load = LANG_LOADERS[langKey];
    if (!load) return fallback(code, lang);
    try {
      const grammar = await load();
      await highlighter.loadLanguage(grammar.default);
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
