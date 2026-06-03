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
import { unregisterParser } from "../lib/parsers/register-from-source";
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
  /**
   * N10 역방향: 파서 워크벤치 '이 파서로 지금 렌더' 트리거. 값이 바뀌면 동일
   * 파일·동일 내용이라도 파서 registry 를 다시 match 해 새 파서로 재렌더한다
   * (런타임 파서 등록은 registry singleton 변이라 content/path 만으로는
   * 재실행되지 않으므로 명시적 nonce 가 필요). 미제공 시 0 — 기존 동작 동일.
   */
  renderNonce?: number;
}

export function SpreadPane({
  workspace,
  pane,
  documentPath,
  content,
  renderNonce = 0,
}: SpreadPaneProps) {
  const { t } = useTranslation();
  const [html, setHtml] = useState<string>("");
  const [activeParser, setActiveParser] = useState<{
    id: string;
    displayName: string;
    reason: string;
    isSystem: boolean;
  } | null>(null);
  // AC(축2) N3: 사용자가 셀렉터로 명시 선택한 파서 id. null = 자동(path 매칭).
  // 설정 시 render() 의 forceParserId 로 흘려 path 매칭을 우회한다.
  const [forcedParserId, setForcedParserId] = useState<string | null>(null);
  // 파서 제거 후 셀렉터 목록을 새로 읽기 위한 버전 카운터 (registry 는
  // singleton 변이라 React 가 변화를 모른다 — 명시적 트리거 필요).
  const [registryVersion, setRegistryVersion] = useState(0);
  const rootRef = useRef<HTMLDivElement | null>(null);
  const renderRef = useRef(createDebouncedRenderer(300));

  // 문서 path/선택 변경 시 override 리셋 — 새 파일은 자동 매칭으로 시작.
  // biome-ignore lint/correctness/useExhaustiveDependencies: forcedParserId reset must key on documentPath only; including it would re-fire and undo a just-made selection.
  useEffect(() => {
    setForcedParserId(null);
  }, [documentPath]);

  // biome-ignore lint/correctness/useExhaustiveDependencies: renderNonce/registryVersion are listed so the N10 reverse trigger + parser removal re-run registry match + render even when content/path are unchanged; Biome flags them because the body doesn't reference them directly.
  useEffect(() => {
    let active = true;
    // T-U10-002-FIX: if a third-party parser claims this file and has a
    // registered SandboxTransport, route the render through the sandbox.
    // Otherwise renderRef falls back to the builtin markdown pipeline.
    // AC(축2): forcedParserId 가 있고 그 파서가 여전히 등록돼 있으면 path 매칭
    // 대신 그 파서로 직접 — 사용자가 셀렉터로 고른 override.
    const registry = getParserRegistry();
    const forced =
      forcedParserId != null
        ? registry.list().find((p) => p.manifest.id === forcedParserId)
        : undefined;
    const matched = forced
      ? { parser: forced, reason: "forced" as const }
      : registry.match({ path: documentPath });
    const parserId = matched?.parser.manifest.id;
    if (matched && parserId) {
      setActiveParser({
        id: parserId,
        displayName: matched.parser.manifest.displayName ?? parserId,
        reason: matched.reason,
        isSystem: registry.isSystem(parserId),
      });
    } else {
      setActiveParser(null);
    }
    const transport =
      parserId && parserId !== BUILTIN_MARKDOWN_ID
        ? (getParserTransport(parserId) ?? undefined)
        : undefined;
    void renderRef
      .current(content, {
        highlightCode: (code, lang) => highlightCode(code, lang),
        path: documentPath,
        ...(forced ? { forceParserId: forced.manifest.id } : {}),
        ...(transport ? { transport } : {}),
      })
      .then((next) => {
        if (active && next !== null) setHtml(next);
      });
    return () => {
      active = false;
      // Cancel any pending debounced render so a late timer can't run
      // render()/sanitizeHtml after this pane unmounts (DOMParser is absent
      // in node-env tests; in prod it avoids a wasted post-unmount render).
      renderRef.current.cancel();
    };
  }, [content, documentPath, renderNonce, forcedParserId, registryVersion]);

  // 셀렉터에 표시할 등록 파서 목록 — 이 문서에 매칭되는 candidate 를 먼저,
  // 그 외 등록 파서를 뒤에 둔다 (즉석 시험을 위해 비매칭 파서도 선택 가능).
  // registryVersion 으로 제거/등록 변이 후 다시 계산. 실제 레지스트리 기반.
  // (매 렌더 재계산 — registryVersion 변화가 곧 재렌더이므로 useMemo 불필요;
  //  파서 수는 소규모라 비용도 무시 가능.)
  void registryVersion;
  const parserOptions = (() => {
    const registry = getParserRegistry();
    const candidateIds = new Set(
      registry.candidates({ path: documentPath }).map((c) => c.parser.manifest.id),
    );
    const all = registry.list().map((p) => ({
      id: p.manifest.id,
      displayName: p.manifest.displayName ?? p.manifest.id,
      isSystem: registry.isSystem(p.manifest.id),
      matches: candidateIds.has(p.manifest.id),
    }));
    // candidate 먼저, 그다음 displayName 알파벳.
    all.sort((a, b) => {
      if (a.matches !== b.matches) return a.matches ? -1 : 1;
      return a.displayName.localeCompare(b.displayName);
    });
    return all;
  })();

  // 파서 제거 — system 파서는 registry 가 거부(false 반환)하므로 버튼 자체를
  // 숨긴다. 제거 후 override 가 그 파서를 가리켰다면 자동 매칭으로 되돌리고
  // registryVersion 을 올려 목록·렌더를 갱신한다.
  const onRemoveParser = (id: string) => {
    /* v8 ignore next -- defensive: the remove button is only rendered for a non-system active parser, so this guard never fires from the UI; it protects against a parser flipping to system between render and click */
    if (getParserRegistry().isSystem(id)) return;
    unregisterParser(id);
    if (forcedParserId === id) setForcedParserId(null);
    setRegistryVersion((v) => v + 1);
  };

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
    /* v8 ignore next -- rootRef is attached before effects run; this guards a future refactor where the section can be conditionally rendered */
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
    /* v8 ignore next -- rootRef is attached before effects run; this guards a future refactor where the section can be conditionally rendered */
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
      {activeParser && (
        <div
          data-testid="active-parser-badge"
          className="not-prose mb-2 flex w-fit items-center gap-1.5 self-end rounded border border-[var(--color-border)] bg-[var(--color-surface-subtle)] px-2 py-0.5 text-[var(--color-muted)] text-xs"
          title={`Parser id: ${activeParser.id} (matched by ${activeParser.reason})`}
        >
          <span className="opacity-60">{t("preview.parser.label", "Parser")}</span>
          {/* AC(축2) N3: 등록 파서 간 선택/전환 — 실제 레지스트리 기반 목록.
              "auto" 는 path 매칭(override 해제). 그 외는 forceParserId override. */}
          <select
            data-testid="parser-selector"
            aria-label={t("preview.parser.select", "Select parser")}
            value={forcedParserId ?? "__auto__"}
            onChange={(e) => {
              const v = e.target.value;
              setForcedParserId(v === "__auto__" ? null : v);
            }}
            className="rounded border border-[var(--color-border)] bg-transparent px-1 py-0.5 text-[var(--color-fg)] text-xs"
          >
            <option value="__auto__">
              {t("preview.parser.auto", "Auto")}
              {forcedParserId == null ? ` · ${activeParser.displayName}` : ""}
            </option>
            {parserOptions.map((p) => (
              <option key={p.id} value={p.id}>
                {p.displayName}
                {p.matches ? "" : ` ${t("preview.parser.nonMatch", "(force)")}`}
                {p.isSystem ? ` · ${t("preview.parser.system", "system")}` : ""}
              </option>
            ))}
          </select>
          <span className="opacity-60" data-testid="active-parser-reason">
            {activeParser.reason}
          </span>
          {/* system 파서가 아닌 활성 파서만 제거 버튼 노출 — registry 가 system
              제거를 거부하므로 UI 에서 미리 차단해 헛수고를 막는다. */}
          {!activeParser.isSystem && (
            <button
              type="button"
              data-testid="parser-remove"
              onClick={() => onRemoveParser(activeParser.id)}
              title={t("preview.parser.remove", "Remove this parser")}
              aria-label={t("preview.parser.remove", "Remove this parser")}
              className="rounded border border-[var(--color-border)] px-1 py-0.5 leading-none hover:bg-[var(--color-border)]/40 hover:text-[var(--color-fg)]"
            >
              ×
            </button>
          )}
        </div>
      )}
      {/* biome-ignore lint/security/noDangerouslySetInnerHtml: html is sanitized markdown render output for preview */}
      <div dangerouslySetInnerHTML={{ __html: html }} />
    </section>
  );
}
