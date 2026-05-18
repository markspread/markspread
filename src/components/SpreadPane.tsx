// S-U07-001 / S-PR-*: rendered markdown preview pane.
//
// Sits next to PaneEditor in spread view-mode. The pipeline is:
//
//   markdown (string) → render() → sanitize → set innerHTML
//      then attach preview plugins on the DOM:
//        - shiki highlightCode (passed to render)
//        - codeCopyButton.attachCodeCopyButtons
//        - checkboxToggle.attachCheckboxToggles
//        - linkClick.attachLinkClickHandler
//        - mermaid.renderMermaidIn
//        - katex.renderMathIn
//      and wire scroll sync against the editor side.
//
// Rendering is debounced (300ms) so fast typing doesn't thrash the
// pipeline; older renders short-circuit via the token check in
// createDebouncedRenderer.

import { invoke } from "@tauri-apps/api/core";
import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import type { PaneNode } from "../lib/editor/layout-model";
import { BUILTIN_MARKDOWN_ID, getParserRegistry } from "../lib/parsers/registry";
import { getParserTransport } from "../lib/parsers/transport-registry";
import { attachCheckboxToggles } from "../lib/preview/checkboxToggle";
import { attachCodeCopyButtons } from "../lib/preview/codeCopyButton";
import { renderMathIn } from "../lib/preview/katex";
import { attachLinkClickHandler } from "../lib/preview/linkClick";
import { renderMermaidIn } from "../lib/preview/mermaid";
import { createDebouncedRenderer } from "../lib/preview/render";
import { emitScroll, isScrollSyncEnabled, onScroll, suppressEcho } from "../lib/preview/scrollSync";
import { highlightCode } from "../lib/preview/shiki";
import { useDocCache } from "../store/doc-cache";

interface SpreadPaneProps {
  workspace: string;
  pane: PaneNode;
  documentPath: string;
  content: string;
}

export function SpreadPane({ workspace, pane, documentPath, content }: SpreadPaneProps) {
  const { t } = useTranslation();
  const [html, setHtml] = useState<string>("");
  const rootRef = useRef<HTMLDivElement | null>(null);
  const renderRef = useRef(createDebouncedRenderer(300));

  useEffect(() => {
    let active = true;
    // T-U10-002-FIX: if a third-party parser claims this file and has a
    // registered SandboxTransport, route the render through the sandbox.
    // Otherwise renderRef falls back to the builtin markdown pipeline.
    const matched = getParserRegistry().match({ path: documentPath });
    const parserId = matched?.parser.manifest.id;
    const transport =
      parserId && parserId !== BUILTIN_MARKDOWN_ID
        ? (getParserTransport(parserId) ?? undefined)
        : undefined;
    void renderRef
      .current(content, {
        highlightCode: (code, lang) => highlightCode(code, lang),
        path: documentPath,
        ...(transport ? { transport } : {}),
      })
      .then((next) => {
        if (active && next !== null) setHtml(next);
      });
    return () => {
      active = false;
    };
  }, [content, documentPath]);

  // After HTML lands, run the post-processing plugins. Each plugin is
  // idempotent (stamps elements with a data attribute) so re-running
  // on the same node tree is safe.
  useEffect(() => {
    const root = rootRef.current;
    if (!root || !html) return;

    attachCodeCopyButtons(root, {
      copy: t("preview.copy", "Copy"),
      copied: t("preview.copied", "Copied"),
    });

    const detachLinks = attachLinkClickHandler(root, {
      openExternal: async (url) => {
        try {
          await invoke("shell_open_external", { url });
        } catch (e) {
          console.warn("[preview/link] external open failed", e);
        }
      },
      openInternal: async (path) => {
        try {
          await invoke("fs_open_tab", { workspace, path });
        } catch (e) {
          console.warn("[preview/link] internal open failed", e);
        }
      },
      resolveInternal: (href) => {
        if (/^[a-z]+:\/\//i.test(href) || href.startsWith("mailto:") || href.startsWith("tel:")) {
          return null;
        }
        const [path, anchor] = href.split("#");
        if (!path) return null;
        return anchor ? { path, anchor } : { path };
      },
    });

    attachCheckboxToggles(root, {
      getSource: () => content,
      toggleLine: ({ lineIndex, oldLength, nextLine }) => {
        const cache = useDocCache.getState();
        const current = cache.getLive(workspace, documentPath) ?? content;
        const lines = current.split(/\r?\n/);
        if (lines[lineIndex] === undefined) return;
        if (lines[lineIndex].length !== oldLength) return;
        lines[lineIndex] = nextLine;
        cache.setLive(workspace, documentPath, lines.join("\n"));
      },
    });

    void renderMermaidIn(root);
    void renderMathIn(root);

    return () => {
      detachLinks();
    };
  }, [html, content, documentPath, workspace, t]);

  // S-PR-010: emit scroll position so the editor side can mirror it.
  // The receive side scrolls only when sync is enabled and the event
  // didn't originate from itself (handled inside scrollSync).
  useEffect(() => {
    const root = rootRef.current;
    if (!root) return;
    const onScrollEvent = () => {
      const fraction =
        root.scrollHeight > root.clientHeight
          ? root.scrollTop / (root.scrollHeight - root.clientHeight)
          : 0;
      emitScroll({ side: "preview", topLine: 1, fraction });
    };
    root.addEventListener("scroll", onScrollEvent, { passive: true });
    return () => root.removeEventListener("scroll", onScrollEvent);
  }, []);

  useEffect(() => {
    const root = rootRef.current;
    if (!root) return;
    return onScroll((e) => {
      if (e.side === "preview") return;
      if (!isScrollSyncEnabled()) return;
      suppressEcho();
      const max = root.scrollHeight - root.clientHeight;
      if (max <= 0) return;
      root.scrollTop = Math.round(max * e.fraction);
    });
  }, []);

  return (
    <section
      data-spread-pane={pane.id}
      aria-label={t("preview.aria", "Markdown preview")}
      className="flex min-h-0 min-w-0 flex-1 flex-col overflow-y-auto p-4 prose dark:prose-invert"
      ref={rootRef}
    >
      {/* biome-ignore lint/security/noDangerouslySetInnerHtml: html is sanitized markdown render output for preview */}
      <div dangerouslySetInnerHTML={{ __html: html }} />
    </section>
  );
}
